import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const PARTNER_MAX_CENTS = 2_147_483_647;

/** Called within the owning business transaction. Deposit never funds purchases. */
export async function postPartnerLedger(
  tx: Prisma.TransactionClient,
  input: {
    partnerId: string;
    account: "BALANCE" | "DEPOSIT";
    type: string;
    deltaCents: number;
    idempotencyKey: string;
    reason: string;
    referenceId?: string;
    actorId?: string;
  },
) {
  if (
    !Number.isSafeInteger(input.deltaCents) ||
    !input.deltaCents ||
    Math.abs(input.deltaCents) > PARTNER_MAX_CENTS
  )
    throw new ConflictException("资金变动金额不正确");
  await tx.$queryRaw`SELECT "partnerId" FROM "PartnerWallet" WHERE "partnerId" = ${input.partnerId}::uuid FOR UPDATE`;
  const existing = await tx.partnerLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (
      existing.partnerId !== input.partnerId ||
      existing.account !== input.account ||
      existing.type !== input.type ||
      existing.deltaCents !== input.deltaCents ||
      existing.referenceId !== (input.referenceId ?? null)
    )
      throw new ConflictException("资金请求编号已被不同参数使用");
    return existing;
  }
  const wallet = await tx.partnerWallet.findUniqueOrThrow({
    where: { partnerId: input.partnerId },
  });
  const field = input.account === "BALANCE" ? "balanceCents" : "depositCents";
  const balanceAfterCents = wallet[field] + input.deltaCents;
  if (balanceAfterCents < 0)
    throw new ConflictException(
      input.account === "BALANCE" ? "余额不足，请先充值" : "保证金余额不足",
    );
  if (
    !Number.isSafeInteger(balanceAfterCents) ||
    balanceAfterCents > PARTNER_MAX_CENTS
  )
    throw new ConflictException("账户金额超过可记录范围，请联系财务");
  await tx.partnerWallet.update({
    where: { partnerId: input.partnerId },
    data: { [field]: balanceAfterCents, version: { increment: 1 } },
  });
  return tx.partnerLedger.create({ data: { ...input, balanceAfterCents } });
}
