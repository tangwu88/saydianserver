import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type CommerceWithdrawal } from "@prisma/client";
import { businessWritesPaused } from "@saydian/app-contracts";
import { isUuid, safeObject, sha256 } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";

type Tx = Prisma.TransactionClient;
const statuses = ["SUBMITTED", "APPROVED", "PROCESSING", "WAIT_USER_CONFIRM", "SUCCEEDED", "FAILED", "REJECTED", "CANCELLED"];
const pending = ["SUBMITTED", "APPROVED", "PROCESSING", "WAIT_USER_CONFIRM"];

/** This service records verified external receipts. It never initiates a provider transfer. */
@Injectable()
export class CommerceWithdrawalService {
  constructor(private readonly prisma: PrismaService) {}

  async employeeSummary(employeeId: string) {
    const dayStart = new Date(Math.floor((Date.now() + 8 * 60 * 60_000) / 86_400_000) * 86_400_000 - 8 * 60 * 60_000);
    const [wallet, identity, withdrawals, plan, pendingCount, dailyUsed] = await Promise.all([
      this.prisma.commerceEmployeeWallet.findUnique({ where: { employeeId } }),
      this.prisma.commerceEmployeePayoutIdentity.findUnique({ where: { employeeId } }),
      this.prisma.commerceWithdrawal.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.commerceCommissionPlan.findUnique({ where: { id: "default" } }),
      this.prisma.commerceWithdrawal.count({ where: { employeeId, status: { in: pending } } }),
      this.prisma.commerceWithdrawal.aggregate({ where: { employeeId, createdAt: { gte: dayStart }, status: { notIn: ["REJECTED", "CANCELLED"] } }, _sum: { amountCents: true } }),
    ]);
    const identityVerified = Boolean(identity?.verifiedAt && identity.verificationEvidence && identity.openId && identity.authorizationId && identity.authorizationStatus === "ACTIVE" && !identity.revokedAt);
    const planReady = Boolean(plan?.enabled && plan.withdrawalEnabled && plan.minimumWithdrawCents !== null && Number.isSafeInteger(plan.minimumWithdrawCents) && plan.minimumWithdrawCents > 0);
    const dailyUsedCents = dailyUsed._sum.amountCents ?? 0;
    const dailyLimit = plan?.dailyWithdrawLimitCents ?? null;
    const dailyLimitValid = dailyLimit === null || (Number.isSafeInteger(dailyLimit) && dailyLimit > 0);
    const dailyRemainingCents = dailyLimit === null ? null : Math.max(0, dailyLimit - dailyUsedCents);
    const availableAmountCents = wallet ? Math.max(0, Math.min(wallet.availableCents, dailyRemainingCents ?? wallet.availableCents)) : null;
    return { wallet, dailyUsedCents, dailyRemainingCents, availableAmountCents, identity: { verified: identityVerified, accountHint: identity ? mask(identity.openId) : null },
      plan: { enabled: Boolean(plan?.enabled && plan.withdrawalEnabled), minimumWithdrawCents: plan?.minimumWithdrawCents ?? null,
        dailyWithdrawLimitCents: plan?.dailyWithdrawLimitCents ?? null, reviewRequired: true, settlementDays: plan?.settlementDays ?? null }, pendingCount,
      canApply: Boolean(planReady && dailyLimitValid && pendingCount === 0 && identityVerified && wallet && wallet.debtCents === 0 && (availableAmountCents ?? 0) >= Math.max(1, plan?.minimumWithdrawCents ?? 1) && !businessWritesPaused(process.env)),
      payoutMode: "MANUAL_RECEIPT_ONLY", withdrawals: withdrawals.map(publicWithdrawal) };
  }

  async adminList(input: unknown) {
    const query = safeObject(input);
    const page = positive(query.page ?? 1, "页码", 1_000_000);
    const pageSize = positive(query.pageSize ?? 30, "分页大小", 100);
    const status = String(query.status ?? "");
    if (status && !statuses.includes(status)) throw new BadRequestException("提现状态无效");
    const where = status ? { status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.commerceWithdrawal.findMany({ where, include: { employee: { select: { name: true, wecomUserId: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.commerceWithdrawal.count({ where }),
    ]);
    return { items: rows.map((row) => ({ ...publicWithdrawal(row), employee: row.employee })), total, page, pageSize };
  }

  async apply(employeeId: string, input: unknown) {
    assertWritable();
    const body = safeObject(input);
    const amountCents = positive(body.amountCents, "提现金额（分）", 2_000_000_000);
    const idempotencyKey = key(body.idempotencyKey);
    const requestHash = sha256(JSON.stringify({ employeeId, amountCents }));
    return this.prisma.$transaction(async (tx) => {
      // Same lock order is used by all withdrawal transitions and commission refunds.
      const wallet = await lockWallet(tx, employeeId);
      const existing = await tx.commerceWithdrawal.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.employeeId !== employeeId || existing.requestHash !== requestHash) throw new ConflictException("幂等键已用于不同提现申请");
        return publicWithdrawal(existing);
      }
      const plan = await tx.commerceCommissionPlan.findUnique({ where: { id: "default" } });
      if (!plan?.enabled || !plan.withdrawalEnabled) throw new ServiceUnavailableException("奖金提现尚未启用");
      if (!Number.isSafeInteger(plan.minimumWithdrawCents) || plan.minimumWithdrawCents === null || plan.minimumWithdrawCents <= 0) throw new ServiceUnavailableException("最低提现金额尚未配置");
      if (amountCents < plan.minimumWithdrawCents) throw new BadRequestException("提现金额低于最低限额");
      if (await tx.commerceWithdrawal.count({ where: { employeeId, status: { in: pending } } })) throw new ConflictException("已有提现处理中，请等待原提现完成");
      if (plan.dailyWithdrawLimitCents !== null) {
        if (!Number.isSafeInteger(plan.dailyWithdrawLimitCents) || plan.dailyWithdrawLimitCents <= 0) throw new ServiceUnavailableException("每日提现限额配置无效");
        const dayStart = new Date(Math.floor((Date.now() + 8 * 60 * 60_000) / 86_400_000) * 86_400_000 - 8 * 60 * 60_000);
        const used = await tx.commerceWithdrawal.aggregate({ where: { employeeId, createdAt: { gte: dayStart },
          status: { notIn: ["REJECTED", "CANCELLED"] } }, _sum: { amountCents: true } });
        if ((used._sum.amountCents ?? 0) + amountCents > plan.dailyWithdrawLimitCents) throw new BadRequestException("超过当日提现限额（北京时间）");
      }
      const employee = await tx.commerceEmployee.findUnique({ where: { id: employeeId } });
      if (!employee?.active) throw new ConflictException("推广账户当前不可申请提现");
      if (wallet.debtCents !== 0) throw new ConflictException("存在退款欠款，结清后才能申请提现");
      if (wallet.availableCents < amountCents) throw new ConflictException("可提现余额不足");
      if (wallet.withdrawingCents + amountCents > 2_147_483_647) throw new ConflictException("提现累计金额超过当前账本范围，请联系财务核验");
      const identity = await tx.commerceEmployeePayoutIdentity.findUnique({ where: { employeeId } });
      if (!identity?.verifiedAt || !identity.verificationEvidence || !identity.openId || !identity.authorizationId || identity.authorizationStatus !== "ACTIVE" || identity.revokedAt) {
        throw new ServiceUnavailableException("收款身份尚未核验，请联系管理员完成原收款身份核验");
      }
      const held = await tx.commerceEmployeeWallet.updateMany({ where: { employeeId, debtCents: 0, availableCents: { gte: amountCents } },
        data: { availableCents: { decrement: amountCents }, withdrawingCents: { increment: amountCents } } });
      if (held.count !== 1) throw new ConflictException("余额已变化，请刷新后重试");
      const row = await tx.commerceWithdrawal.create({ data: { employeeId, amountCents, idempotencyKey, requestHash,
        sourceSystem: "canonical", executionOwner: "NEW_SYSTEM", status: "SUBMITTED",
        payoutIdentitySnapshot: { openId: identity.openId, authorizationId: identity.authorizationId,
          verifiedAt: identity.verifiedAt.toISOString(), verificationEvidence: identity.verificationEvidence },
      } });
      await tx.commerceCommissionLedger.create({ data: { employeeId, withdrawalId: row.id, type: "WITHDRAW_HOLD",
        availableDeltaCents: -amountCents, withdrawingDeltaCents: amountCents, idempotencyKey: `withdrawal-hold:${row.id}` } });
      return publicWithdrawal(row);
    }).catch(databaseConflict);
  }

  review(id: string, actorId: string, input: unknown) {
    const body = safeObject(input);
    const decision = String(body.decision ?? "");
    if (!["APPROVE", "REJECT"].includes(decision)) throw new BadRequestException("审核操作无效");
    const note = requiredText(body.note, "审核说明", 1000);
    return this.transition(id, actorId, body, { action: "REVIEW", decision, note }, async (tx, row) => {
      ownNew(row);
      if (decision === "APPROVE" && row.status !== "SUBMITTED") throw new ConflictException("仅待审核提现可批准");
      if (decision === "REJECT" && !["SUBMITTED", "APPROVED"].includes(row.status)) throw new ConflictException("该状态不能拒绝；在途付款须核验原回执");
      const data = { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: actorId, reviewedAt: new Date(), reviewNote: note,
        ...(decision === "REJECT" ? { completedAt: new Date() } : {}) };
      if (decision === "REJECT") return { data, ...(await this.release(tx, row)) };
      return { data, type: "WITHDRAW_APPROVE", availableDeltaCents: 0, withdrawingDeltaCents: 0, debtDeltaCents: 0, paidDeltaCents: 0 };
    });
  }

  recordManualReceipt(id: string, actorId: string, input: unknown) {
    const body = safeObject(input);
    const receipt = parseReceipt(body, false);
    return this.transition(id, actorId, body, { action: "MANUAL_RECEIPT", ...receipt }, async (tx, row) => {
      ownNew(row);
      if (row.status !== "APPROVED") throw new ConflictException("仅已审核且未进入供应商处理的提现可登记人工付款凭证");
      assertReceipt(row, receipt);
      return this.completePayment(tx, row, receipt);
    });
  }

  verifyLegacyResult(id: string, actorId: string, input: unknown) {
    const body = safeObject(input);
    const receipt = parseReceipt(body, true);
    return this.transition(id, actorId, body, { action: "VERIFY_ORIGINAL_TRANSFER", ...receipt }, async (tx, row) => {
      if (row.sourceSystem === "canonical" || !["PROCESSING", "WAIT_USER_CONFIRM"].includes(row.status) || !row.providerTransferId) {
        throw new ConflictException("仅迁入在途提现可核验原供应商结果，不能新建付款");
      }
      if (row.providerTransferId !== receipt.providerTransferId) throw new ConflictException("必须核验原供应商转账单号，不能替换或重发");
      assertReceipt(row, receipt);
      if (receipt.result === "SUCCEEDED") return this.completePayment(tx, row, receipt);
      return { data: { status: "FAILED", verificationEvidence: receipt.evidence, receiptReference: receipt.receiptReference,
        completedAt: new Date(receipt.completedAt) }, ...(await this.release(tx, row)) };
    });
  }

  private async completePayment(tx: Tx, row: CommerceWithdrawal, receipt: Receipt): Promise<TransitionResult> {
    const wallet = await tx.commerceEmployeeWallet.findUnique({ where: { employeeId: row.employeeId } });
    if (!wallet || wallet.totalPaidCents + row.amountCents > 2_147_483_647) throw new ConflictException("累计付款金额超出当前账本范围，请联系财务核验");
    const updated = await tx.commerceEmployeeWallet.updateMany({ where: { employeeId: row.employeeId, withdrawingCents: { gte: row.amountCents } },
      data: { withdrawingCents: { decrement: row.amountCents }, totalPaidCents: { increment: row.amountCents } } });
    if (updated.count !== 1) throw new ConflictException("提现冻结金额不足，必须先核验迁移账本");
    return { data: { status: "SUCCEEDED", providerTransferId: receipt.providerTransferId, receiptReference: receipt.receiptReference,
      verificationEvidence: receipt.evidence, paidAt: new Date(receipt.completedAt), completedAt: new Date(receipt.completedAt) }, type: "WITHDRAW_SUCCESS", availableDeltaCents: 0,
      withdrawingDeltaCents: -row.amountCents, paidDeltaCents: row.amountCents, debtDeltaCents: 0 };
  }

  private async release(tx: Tx, row: CommerceWithdrawal) {
    const wallet = await tx.commerceEmployeeWallet.findUnique({ where: { employeeId: row.employeeId } });
    if (!wallet || wallet.withdrawingCents < row.amountCents) throw new ConflictException("提现冻结金额不足，必须先核验迁移账本");
    // If a refund created debt while funds were held, release settles debt first, not spendable money.
    const debtOffset = Math.min(wallet.debtCents, row.amountCents);
    await tx.commerceEmployeeWallet.update({ where: { employeeId: row.employeeId }, data: {
      withdrawingCents: { decrement: row.amountCents }, debtCents: { decrement: debtOffset }, availableCents: { increment: row.amountCents - debtOffset },
    } });
    return { type: "WITHDRAW_RELEASE", availableDeltaCents: row.amountCents - debtOffset,
      withdrawingDeltaCents: -row.amountCents, debtDeltaCents: -debtOffset, paidDeltaCents: 0 };
  }

  private async transition(id: string, actorId: string, body: Record<string, unknown>, operation: Record<string, unknown>,
    run: (tx: Tx, row: CommerceWithdrawal) => Promise<TransitionResult>) {
    assertWritable();
    if (!isUuid(id)) throw new BadRequestException("提现编号无效");
    const version = nonNegative(body.version, "版本");
    const operationKey = `withdrawal-op:${key(body.idempotencyKey)}`;
    const hash = sha256(JSON.stringify({ id, actorId, version, ...operation }));
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.commerceWithdrawal.findUnique({ where: { id } });
      if (!initial) throw new NotFoundException("提现记录不存在");
      await lockWallet(tx, initial.employeeId);
      const row = await tx.commerceWithdrawal.findUniqueOrThrow({ where: { id } });
      const applied = await tx.commerceCommissionLedger.findUnique({ where: { idempotencyKey: operationKey } });
      if (applied) {
        if (applied.withdrawalId !== id || applied.memo !== hash) throw new ConflictException("幂等键已用于不同操作或参数");
        return publicWithdrawal(row);
      }
      if (row.version !== version) throw new ConflictException("提现状态已变化，请刷新后重试");
      const result = await run(tx, row);
      const changed = await tx.commerceWithdrawal.updateMany({ where: { id, version }, data: { ...result.data, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("提现已被其他操作更新");
      await tx.commerceCommissionLedger.create({ data: { employeeId: row.employeeId, withdrawalId: id, type: result.type,
        availableDeltaCents: result.availableDeltaCents, withdrawingDeltaCents: result.withdrawingDeltaCents,
        debtDeltaCents: result.debtDeltaCents, paidDeltaCents: result.paidDeltaCents, idempotencyKey: operationKey, memo: hash } });
      await tx.auditLog.create({ data: { actorType: "ADMIN", actorId, action: `WITHDRAWAL_${operation.action}`, entityType: "CommerceWithdrawal", entityId: id } });
      return publicWithdrawal(await tx.commerceWithdrawal.findUniqueOrThrow({ where: { id } }));
    }).catch(databaseConflict);
  }
}

type TransitionResult = { data: Prisma.CommerceWithdrawalUpdateManyMutationInput; type: string;
  availableDeltaCents: number; withdrawingDeltaCents: number; debtDeltaCents: number; paidDeltaCents: number };
type Receipt = { providerTransferId: string; amountCents: number; recipientOpenId: string; receiptReference: string; evidence: string;
  completedAt: string; result: "SUCCEEDED" | "FAILED" };
function parseReceipt(body: Record<string, unknown>, allowFailure: boolean): Receipt {
  if (body.confirmedExternalResult !== true) throw new BadRequestException("必须确认已从原供应商或真实付款凭证核验结果；此操作不会发起打款");
  const result = String(body.result ?? "SUCCEEDED");
  if (result !== "SUCCEEDED" && !(allowFailure && result === "FAILED")) throw new BadRequestException("只能登记已核验的终态结果");
  const completedAt = new Date(String(body.completedAt ?? ""));
  if (!Number.isFinite(completedAt.getTime()) || completedAt.getTime() > Date.now()) throw new BadRequestException("实际完成时间无效或在未来");
  return { providerTransferId: requiredText(body.providerTransferId, "原供应商转账单号", 128),
    amountCents: positive(body.amountCents, "回执金额（分）", 2_000_000_000), recipientOpenId: requiredText(body.recipientOpenId, "回执收款身份", 128),
    receiptReference: requiredText(body.receiptReference, "回执凭证索引", 500), evidence: requiredText(body.evidence, "核验依据", 2000),
    completedAt: completedAt.toISOString(), result: result as Receipt["result"] };
}
function assertReceipt(row: CommerceWithdrawal, receipt: Receipt) {
  const snapshot = safeObject(row.payoutIdentitySnapshot);
  if (!snapshot.openId || snapshot.openId !== receipt.recipientOpenId || row.amountCents !== receipt.amountCents) throw new ConflictException("回执收款身份或金额与冻结申请不一致");
  if (new Date(receipt.completedAt) < row.createdAt) throw new ConflictException("回执完成时间早于提现申请");
}
function ownNew(row: CommerceWithdrawal) {
  if (row.executionOwner !== "NEW_SYSTEM") throw new ConflictException("原系统提现尚未完成接管；在途只能核验原转账结果");
  if (row.providerTransferId || row.status === "PROCESSING" || row.status === "WAIT_USER_CONFIRM") throw new ConflictException("已有原供应商付款记录，禁止新建或重发付款");
}
async function lockWallet(tx: Tx, employeeId: string) {
  await tx.$queryRaw`SELECT "employeeId" FROM "CommerceEmployeeWallet" WHERE "employeeId" = ${employeeId}::uuid FOR UPDATE`;
  const wallet = await tx.commerceEmployeeWallet.findUnique({ where: { employeeId } });
  if (!wallet) throw new ConflictException("佣金钱包尚未核验或未建立");
  if ([wallet.availableCents, wallet.withdrawingCents, wallet.debtCents, wallet.totalPaidCents].some((value) => value < 0)) throw new ConflictException("钱包账本异常，请先核验");
  return wallet;
}
function publicWithdrawal(row: CommerceWithdrawal) {
  return { id: row.id, withdrawalNo: row.withdrawalNo, employeeId: row.employeeId, legacyId: row.legacyId, sourceSystem: row.sourceSystem,
    executionOwner: row.executionOwner, amountCents: row.amountCents, status: row.status, version: row.version,
    accountHint: mask(String(safeObject(row.payoutIdentitySnapshot).openId ?? "")), providerTransferId: row.providerTransferId,
    receiptReference: row.receiptReference, reviewNote: row.reviewNote, createdAt: row.createdAt, reviewedAt: row.reviewedAt,
    paidAt: row.paidAt, completedAt: row.completedAt, pending: pending.includes(row.status) };
}
function mask(value: string) { return value ? `${value.slice(0, 3)}***${value.slice(-3)}` : null; }
function key(value: unknown) {
  const text = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(text)) throw new BadRequestException("幂等键需为 16～100 位字母、数字、短横线或下划线");
  return text;
}
function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u0008]/.test(value)) throw new BadRequestException(`${label}必填且长度不超过 ${max}`);
  return value.trim();
}
function nonNegative(value: unknown, label: string) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0 || number > 2_147_483_647) throw new BadRequestException(`${label}必须为非负整数`);
  return number;
}
function positive(value: unknown, label: string, max: number) {
  const number = nonNegative(value, label);
  if (number === 0 || number > max) throw new BadRequestException(`${label}必须为 1～${max} 的整数`);
  return number;
}
function assertWritable() {
  if (businessWritesPaused(process.env)) throw new ServiceUnavailableException("维护核验期间暂停提现写入");
}
function databaseConflict(error: unknown): never {
  if (safeObject(error).code === "P2002") throw new ConflictException("幂等键或转账单号已被使用，请刷新核对原记录，勿重复付款");
  throw error;
}
