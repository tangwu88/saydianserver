import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AccountDeletionStatus, AdminRole, Prisma, UserStatus } from "@prisma/client";
import { isUuid, safeObject } from "../common/crypto";
import type { PrismaService } from "../common/prisma.service";

export async function cancelAccountDeletion(
  prisma: PrismaService,
  current: { id: string; role: string; roles?: string[] },
  id: string,
  input: unknown,
  requestId: string,
) {
  const roles = current.roles?.length ? current.roles : [current.role];
  if (!roles.includes(AdminRole.SUPER_ADMIN)) throw new ForbiddenException("仅超级管理员可撤销注销");
  const body = safeObject(input);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const date = typeof body.expectedRequestedAt === "string" ? new Date(body.expectedRequestedAt) : null;
  if (!isUuid(id) || typeof body.expectedUserId !== "string" || !isUuid(body.expectedUserId) ||
    !date || !Number.isFinite(date.getTime()) || date.toISOString() !== body.expectedRequestedAt ||
    body.confirm !== true || reason.length < 5 || reason.length > 200 || /[\u0000-\u001f\u007f]/u.test(reason) ||
    Object.keys(body).some(key => !["expectedUserId", "expectedRequestedAt", "confirm", "reason"].includes(key))) {
    throw new BadRequestException("请确认会员和注销申请，并填写5至200字的撤销原因");
  }
  const expectedUserId = body.expectedUserId;
  return prisma.$transaction(async tx => {
    // Same lock order as requesting deletion: user first, then all its requests.
    // A worker that already claimed REQUESTED must finish; we never restore it.
    const users = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "User" WHERE id = ${expectedUserId}::uuid FOR UPDATE`);
    if (!users.length) throw new NotFoundException("会员不存在");
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "AccountDeletionRequest" WHERE "userId" = ${expectedUserId}::uuid ORDER BY id FOR UPDATE`);
    const user = await tx.user.findUniqueOrThrow({ where: { id: expectedUserId }, select: { id: true, status: true } });
    const requests = await tx.accountDeletionRequest.findMany({ where: { userId: expectedUserId }, orderBy: { id: "asc" } });
    const target = requests.find(item => item.id === id);
    if (!target) throw new NotFoundException("未找到该会员的注销申请");
    if (target.requestedAt.getTime() !== date.getTime()) throw new ConflictException("注销申请已变化，请刷新后重试");
    const pending = requests.filter(item => item.status === AccountDeletionStatus.REQUESTED);
    const unsafe = requests.some(item => item.status !== AccountDeletionStatus.REQUESTED && item.status !== AccountDeletionStatus.CANCELLED);
    if (target.status === AccountDeletionStatus.CANCELLED && user.status === UserStatus.ACTIVE && !pending.length && !unsafe) {
      return { id, userId: user.id, status: AccountDeletionStatus.CANCELLED, userStatus: user.status, alreadyCancelled: true };
    }
    if (unsafe || user.status !== UserStatus.DELETION_PENDING || target.status !== AccountDeletionStatus.REQUESTED) {
      throw new ConflictException("账号或注销任务状态已变化；已开始处理、失败或完成的注销不可撤销");
    }
    // CAS also protects against a worker claim when the locking protocol changes.
    const cancelled = await tx.accountDeletionRequest.updateMany({
      where: { userId: user.id, id: { in: pending.map(item => item.id) }, status: AccountDeletionStatus.REQUESTED },
      data: { status: AccountDeletionStatus.CANCELLED },
    });
    if (cancelled.count !== pending.length) throw new ConflictException("注销任务已开始处理，无法撤销");
    const restored = await tx.user.updateMany({ where: { id: user.id, status: UserStatus.DELETION_PENDING }, data: { status: UserStatus.ACTIVE } });
    if (restored.count !== 1) throw new ConflictException("账号状态已变化，请刷新后重试");
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId: current.id, action: "ACCOUNT_DELETION_CANCELLED", entityType: "USER", entityId: user.id, requestId,
      beforeJson: { userStatus: user.status, requests: pending.map(item => ({ id: item.id, status: item.status })) },
      afterJson: { userStatus: UserStatus.ACTIVE, requestIds: pending.map(item => item.id), status: AccountDeletionStatus.CANCELLED, reason },
    } });
    // Revoked sessions and disabled push registrations stay revoked/disabled.
    // Health, identities, verification and profile records are deliberately untouched.
    return { id, userId: user.id, status: AccountDeletionStatus.CANCELLED, userStatus: UserStatus.ACTIVE, alreadyCancelled: false };
  }, { maxWait: 5000, timeout: 10000 });
}
