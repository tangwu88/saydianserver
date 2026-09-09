import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma, type PrismaClient } from "@prisma/client";

export const takeoverEvidenceKeys = [
  "client_contract", "source_freeze", "callback_route", "media", "identity",
  "financial", "inventory", "reverse_replay", "outstanding_jobs",
] as const;

export interface TakeoverManifest {
  sourceSystem: "legacy_mall";
  migrationRunId: string;
  sourceSnapshotId: string;
  expectedStateDigest: string;
  windowStartedAt: string;
  evidence: Record<string, { path: string; sha256: string }>;
  enqueueErpOrderIds?: string[];
}

type PaymentEvidence = { id: string; channel: string; status: string; providerMerchantId: string | null; providerAppId: string | null; providerTransactionId: string | null };
export function paymentTakeoverProblems(payments: PaymentEvidence[]): string[] {
  const problems: string[] = [];
  for (const payment of payments) {
    if (payment.channel.startsWith("WECHAT_") && (!payment.providerMerchantId || !payment.providerAppId)) problems.push(`payment:${payment.id}:original_wechat_merchant_or_app_missing`);
    if (payment.channel.startsWith("ALIPAY_") && !payment.providerAppId) problems.push(`payment:${payment.id}:original_alipay_app_missing`);
    if (["SUCCEEDED", "REFUNDING", "PARTIAL_REFUNDED", "REFUNDED"].includes(payment.status) && !payment.providerTransactionId) problems.push(`payment:${payment.id}:provider_transaction_missing`);
  }
  return problems;
}

async function validateEvidence(manifest: TakeoverManifest): Promise<string[]> {
  const problems: string[] = [];
  for (const name of takeoverEvidenceKeys) {
    const evidence = manifest.evidence?.[name];
    if (!evidence?.path || !/^[a-f0-9]{64}$/i.test(evidence.sha256 ?? "")) { problems.push(`evidence:${name}:missing`); continue; }
    try {
      const bytes = await readFile(evidence.path);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const report = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      if (digest !== evidence.sha256.toLowerCase() || report.status !== "PASS" || report.sourceSnapshotId !== manifest.sourceSnapshotId || !String(report.reviewedBy ?? "").trim()) {
        problems.push(`evidence:${name}:not_verified_for_snapshot`);
      }
    } catch { problems.push(`evidence:${name}:unreadable`); }
  }
  return problems;
}

async function databaseState(target: Prisma.TransactionClient, sourceSystem: string) {
  const employeeMaps = await target.legacyIdMap.findMany({ where: { sourceSystem, entityType: "mall_employee" }, select: { targetId: true }, orderBy: { targetId: "asc" } });
  const employeeIds = employeeMaps.map((mapping) => mapping.targetId);
  const [orders, payments, refunds, afterSales, withdrawals, wallets, ledger, accruals, payoutIdentities, commissionPlan] = await Promise.all([
    target.commerceOrder.findMany({ where: { sourceSystem }, include: { items: { orderBy: { id: "asc" } }, shipments: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
    target.paymentIntent.findMany({ where: { sourceSystem }, orderBy: { id: "asc" } }),
    target.paymentRefund.findMany({ where: { sourceSystem }, orderBy: { id: "asc" } }),
    target.commerceAfterSale.findMany({ where: { sourceSystem }, include: { items: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
    target.commerceWithdrawal.findMany({ where: { sourceSystem }, orderBy: { id: "asc" } }),
    target.commerceEmployeeWallet.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { employeeId: "asc" } }),
    target.commerceCommissionLedger.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: "asc" } }),
    target.commerceCommissionAccrual.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: "asc" } }),
    target.commerceEmployeePayoutIdentity.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { employeeId: "asc" } }),
    target.commerceCommissionPlan.findUnique({ where: { id: "default" } }),
  ]);
  const digest = createHash("sha256").update(JSON.stringify({ orders, payments, refunds, afterSales, withdrawals, wallets, ledger, accruals, payoutIdentities, commissionPlan })).digest("hex");
  return { orders, payments, refunds, afterSales, withdrawals, digest };
}

export async function checkTakeover(target: PrismaClient, manifest: TakeoverManifest) {
  if (manifest.sourceSystem !== "legacy_mall") throw new Error("This takeover adapter only supports the reviewed legacy_mall schema");
  const problems = await validateEvidence(manifest);
  const run = await target.migrationRun.findUnique({ where: { id: manifest.migrationRunId } });
  if (!run || run.status !== "COMPLETED" || asRecord(run.report).matched !== true || run.sourceDigest !== manifest.sourceSnapshotId) problems.push("migration:verified_snapshot_missing");
  const unresolved = await target.migrationConflict.count({ where: { runId: manifest.migrationRunId, resolvedAt: null } });
  if (unresolved) problems.push("migration:unresolved_conflicts");
  const state = await databaseState(target, manifest.sourceSystem);
  problems.push(...paymentTakeoverProblems(state.payments));
  for (const order of state.orders) {
    if (!order.items.length || order.items.reduce((sum, item) => sum + item.totalCents, 0) !== order.subtotalCents) problems.push(`order:${order.id}:item_amounts_not_reconciled`);
    if (order.executionOwner !== "LEGACY_SYSTEM") problems.push(`order:${order.id}:not_exclusively_locked_for_takeover`);
  }
  for (const record of [...state.payments, ...state.refunds, ...state.afterSales, ...state.withdrawals]) {
    if (record.executionOwner !== "LEGACY_SYSTEM") problems.push(`transaction:${record.id}:ownership_not_locked`);
  }
  for (const withdrawal of state.withdrawals) {
    if (["PROCESSING", "WAIT_USER_CONFIRM", "SUCCEEDED"].includes(withdrawal.status) &&
      (!withdrawal.providerTransferId || !asRecord(withdrawal.payoutIdentitySnapshot).openId)) {
      problems.push(`withdrawal:${withdrawal.id}:original_transfer_identity_or_receipt_missing`);
    }
  }
  for (const refund of state.refunds) {
    if (["PROCESSING", "SUCCEEDED"].includes(refund.status) && !refund.providerRefundId) problems.push(`refund:${refund.id}:original_provider_refund_id_missing`);
  }
  for (const id of manifest.enqueueErpOrderIds ?? []) {
    const order = state.orders.find((item) => item.id === id);
    if (!order || order.erpOrderId || !["PAID", "WAITING_FULFILLMENT"].includes(order.status)) problems.push(`erp:${id}:not_a_verified_pending_submission`);
  }
  if (manifest.expectedStateDigest && manifest.expectedStateDigest !== state.digest) problems.push("migration:target_state_changed_since_review");
  return { ready: problems.length === 0, sourceSnapshotId: manifest.sourceSnapshotId, stateDigest: state.digest, problems,
    counts: { orders: state.orders.length, payments: state.payments.length, refunds: state.refunds.length, afterSales: state.afterSales.length, withdrawals: state.withdrawals.length } };
}

export async function activateTakeover(target: PrismaClient, manifest: TakeoverManifest) {
  const paused = [process.env.MAINTENANCE_READ_ONLY, process.env.BUSINESS_WRITES_PAUSED].some((value) => ["true", "1", "yes"].includes(value?.trim().toLowerCase() ?? ""));
  if (process.env.MIGRATION_TARGET_WRITES_FROZEN !== "true" || process.env.MIGRATION_OWNERSHIP_TRANSFER_APPROVED !== "true" ||
    !paused) throw new Error("Takeover requires a frozen target, paused workers and explicit ownership-transfer approval");
  if (!manifest.expectedStateDigest) throw new Error("Takeover requires the reviewed exact state digest");
  assertCutoverWindow(manifest.windowStartedAt);
  const result = await checkTakeover(target, manifest);
  if (!result.ready) throw new Error(`Takeover blocked: ${result.problems.join(", ")}`);
  await target.$transaction(async (tx) => {
    const current = await databaseState(tx, manifest.sourceSystem);
    if (current.digest !== manifest.expectedStateDigest) throw new Error("Target changed after takeover verification");
    const where = { sourceSystem: manifest.sourceSystem, executionOwner: "LEGACY_SYSTEM" };
    await tx.commerceOrder.updateMany({ where, data: { executionOwner: "NEW_SYSTEM", version: { increment: 1 } } });
    await tx.paymentIntent.updateMany({ where, data: { executionOwner: "NEW_SYSTEM" } });
    await tx.paymentRefund.updateMany({ where, data: { executionOwner: "NEW_SYSTEM" } });
    await tx.commerceAfterSale.updateMany({ where, data: { executionOwner: "NEW_SYSTEM", version: { increment: 1 } } });
    await tx.commerceWithdrawal.updateMany({ where, data: { executionOwner: "NEW_SYSTEM", version: { increment: 1 }, verificationEvidence: `sha256:${manifest.evidence.financial!.sha256}` } });
    const identityMaps = await tx.legacyIdMap.findMany({ where: { sourceSystem: manifest.sourceSystem, entityType: "mall_payout_identity" }, select: { targetId: true } });
    await tx.commerceEmployeePayoutIdentity.updateMany({
      where: { employeeId: { in: identityMaps.map((mapping) => mapping.targetId) }, authorizationStatus: { in: ["AUTHORIZED", "ACTIVE"] }, revokedAt: null },
      // The archived source row/hash keeps the original status; only reviewed,
      // non-revoked authorizations become the canonical ACTIVE identity.
      data: { authorizationStatus: "ACTIVE", verifiedAt: new Date(), verificationEvidence: `sha256:${manifest.evidence.identity!.sha256}` },
    });
    for (const orderId of manifest.enqueueErpOrderIds ?? []) await tx.commerceIntegrationJob.upsert({
      where: { idempotencyKey: `jushuitan-order:${orderId}` },
      create: { type: "JUSHUITAN_ORDER_PUSH", idempotencyKey: `jushuitan-order:${orderId}`, aggregateType: "commerce_order", aggregateId: orderId, payload: { orderId } }, update: {},
    });
    const run = await tx.migrationRun.findUniqueOrThrow({ where: { id: manifest.migrationRunId } });
    await tx.migrationRun.update({ where: { id: run.id }, data: { report: { ...asRecord(run.report), takeover: {
      stateDigest: result.stateDigest, activatedAt: new Date().toISOString(), evidence: manifest.evidence, counts: result.counts,
      note: "Ownership transferred atomically. Business writes and outbound workers remain subject to independent freeze switches.",
    } } as unknown as Prisma.InputJsonValue } });
    // Expiration during the transaction rolls back the ownership change too.
    assertCutoverWindow(manifest.windowStartedAt);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
  return { ...result, activated: true };
}

export function assertCutoverWindow(startedAt: string, now = Date.now()): void {
  const started = new Date(startedAt).valueOf();
  if (!Number.isFinite(started) || started > now || now - started >= 30 * 60_000) throw new Error("The approved 30-minute cutover window is missing or has expired");
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
