import type { Prisma } from "@prisma/client";
import { HealthScreenError } from "./policy";
/** Same member lock used by existing App/admin health reports. */
export async function lockReportCredits(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"health-report-create:" + userId}, 0))`;
}
export async function availableAnalysisCredits(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const now = new Date();
  const [standalone, memberships] = await Promise.all([
    tx.reportCreditLedger.aggregate({
      where: { userId, membershipId: null },
      _sum: { delta: true },
    }),
    tx.healthMembership.aggregate({
      where: {
        userId,
        status: "ACTIVE",
        startsAt: { lte: now },
        expiresAt: { gt: now },
      },
      _sum: { remainingCredits: true },
    }),
  ]);
  return Math.max(
    0,
    (standalone._sum.delta || 0) + (memberships._sum.remainingCredits || 0),
  );
}
export async function consumeAnalysisCredit(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  const key = `member-analysis-consume:${id}`;
  if (
    await tx.reportCreditLedger.findUnique({ where: { idempotencyKey: key } })
  )
    return;
  const total = await availableAnalysisCredits(tx, userId);
  if (total < 1)
    throw new HealthScreenError(
      "credits_required",
      "没有可用的健康报告次数",
      409,
    );
  const now = new Date();
  const membership = await tx.healthMembership.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      startsAt: { lte: now },
      expiresAt: { gt: now },
      remainingCredits: { gt: 0 },
    },
    orderBy: { expiresAt: "asc" },
  });
  if (membership) {
    const changed = await tx.healthMembership.updateMany({
      where: {
        id: membership.id,
        remainingCredits: { gt: 0 },
        status: "ACTIVE",
      },
      data: { remainingCredits: { decrement: 1 } },
    });
    if (changed.count !== 1)
      throw new HealthScreenError(
        "credits_changed",
        "报告次数已变化，请刷新",
        409,
      );
  }
  await tx.reportCreditLedger.create({
    data: {
      userId,
      type: "CONSUME",
      delta: -1,
      balanceAfter: total - 1,
      sourceType: membership ? "health_membership" : "report_credit",
      sourceId: membership?.id || id,
      membershipId: membership?.id || null,
      memberHealthAnalysisId: id,
      expiresAt: membership?.expiresAt || null,
      idempotencyKey: key,
    },
  });
}
export async function restoreAnalysisCredit(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  const key = `member-analysis-restore:${id}`;
  if (
    await tx.reportCreditLedger.findUnique({ where: { idempotencyKey: key } })
  )
    return;
  const consumed = await tx.reportCreditLedger.findUnique({
    where: { idempotencyKey: `member-analysis-consume:${id}` },
  });
  if (!consumed) return;
  const membership = consumed.membershipId
    ? await tx.healthMembership.findUnique({
        where: { id: consumed.membershipId },
      })
    : null;
  const restoreMember =
    membership?.status === "ACTIVE" &&
    membership.expiresAt &&
    membership.expiresAt > new Date();
  if (restoreMember && membership)
    await tx.healthMembership.update({
      where: { id: membership.id },
      data: { remainingCredits: { increment: 1 } },
    });
  const balance = await availableAnalysisCredits(tx, userId);
  await tx.reportCreditLedger.create({
    data: {
      userId,
      type: "ADMIN_ADJUSTMENT",
      delta: 1,
      balanceAfter: balance + (restoreMember ? 0 : 1),
      sourceType: "generation_failure",
      sourceId: id,
      membershipId: restoreMember ? membership!.id : null,
      memberHealthAnalysisId: id,
      expiresAt: restoreMember ? membership!.expiresAt : null,
      idempotencyKey: key,
      note: "健康大屏分析失败，次数已退回",
    },
  });
}
