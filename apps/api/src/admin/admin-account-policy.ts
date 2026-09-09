import { ConflictException, NotFoundException } from "@nestjs/common";
import { AdminRole, Prisma } from "@prisma/client";

/** Exactly mirrors AdminAuthGuard: roles takes precedence; role is legacy fallback. */
export function isEnabledSuperAdmin(admin: { active: boolean; role: string; roles: readonly string[] }): boolean {
  return admin.active && (admin.roles.length ? admin.roles : [admin.role]).includes("SUPER_ADMIN");
}

/** Serialize role/active edits, including concurrent demotion of two remaining super admins. */
export async function protectLastSuperAdmin(
  tx: Prisma.TransactionClient, id: string, change: { roles?: AdminRole[]; active?: boolean },
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(734220091::bigint)`;
  const current = await tx.adminUser.findUnique({ where: { id }, select: { id: true, active: true, role: true, roles: true } });
  if (!current) throw new NotFoundException("后台账号不存在");
  const proposed = { ...current, ...change, ...(change.roles ? { role: change.roles[0]! } : {}) };
  if (!isEnabledSuperAdmin(current) || isEnabledSuperAdmin(proposed)) return;
  const activeAdmins = await tx.adminUser.findMany({
    where: { active: true, id: { not: id } }, select: { active: true, role: true, roles: true },
  });
  if (!activeAdmins.some(isEnabledSuperAdmin)) throw new ConflictException("至少保留一个启用的超级管理员，不能停用或降级最后一个超管");
}
