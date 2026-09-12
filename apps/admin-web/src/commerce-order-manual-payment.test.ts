import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

function harness(roles = ["SUPER_ADMIN"]) {
  const source = readFileSync(new URL("./components/CommerceWorkspace.vue", import.meta.url), "utf8")
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile("commerce-workspace.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(
    ast.statements.filter(node => !ts.isImportDeclaration(node))
      .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText;
  const order = {
    id: "order-1",
    orderNo: "SD-SYNTHETIC-001",
    status: "PENDING_PAYMENT",
    executionOwner: "NEW_SYSTEM",
    payableCents: 9_100,
    currency: "CNY",
    version: 2,
    paidAt: null,
    paymentIntents: [] as Array<{ channel: string; status: string }>,
  };
  const props = { resource: "commerce-orders", rows: [order], meta: {}, loading: false, createable: false, search: "" };
  const emit = vi.fn();
  const api = { post: vi.fn(async (path: string) => ({ data: { data:
    path.includes("/payments/") && path.endsWith("/close")
      ? { orderId: order.id, paymentId: "payment-1", paymentStatus: "CLOSED", orderVersion: 3 }
      : path.endsWith("/close")
        ? { ...order, status: "CANCELLED", version: 3, cancelledAt: "2026-09-11T12:00:00.000Z" }
        : { ...order, status: "PAID", payableCents: 9_000, version: 3, paidAt: "2026-09-11T12:00:00.000Z" }
  } })) };
  const ElMessage = { success: vi.fn(), error: vi.fn() };
  const confirm = vi.fn(async () => true);
  const prompt = vi.fn(async () => ({ value: "客户要求改价，已核对尚未付款" }));
  const deps = {
    computed,
    ref,
    watch: vi.fn(),
    defineProps: () => props,
    defineEmits: () => emit,
    canAdminResource: () => true,
    getAdminRoles: () => roles,
    api,
    responseData: (response: any) => response.data.data,
    readableError: (error: unknown) => error instanceof Error ? error.message : "请求失败",
    ElMessage,
    ElMessageBox: { confirm, prompt },
    crypto: { randomUUID: () => "synthetic-action-key" },
  };
  const state = new Function(
    ...Object.keys(deps),
    `${code}\nreturn { detailRow, detailVisible, manualOrderVisible, manualOrderSaving, manualOrderForm, paymentCloseSaving, orderCloseSaving, canManuallySettleOrder, openDetail, openManualOrder, saveManualOrder, paymentChannelLabel, hasActiveOnlinePayment, activeOnlinePayment, orderAddress, closeOnlinePayment, closeOrder };`,
  )(...Object.values(deps));
  return { ...state, order, api, emit, ElMessage, confirm, prompt };
}

describe("commerce order super-admin payment controls", () => {
  it("submits integer cents, current version, idempotency key, and mandatory receipt note", async () => {
    const h = harness(); h.openDetail(h.order); h.openManualOrder(h.order);
    expect(h.manualOrderVisible.value).toBe(true);
    expect(h.manualOrderForm.value).toMatchObject({ action: "ADJUST_PRICE", payableYuan: 91, orderVersion: 2, idempotencyKey: "synthetic-action-key" });
    h.manualOrderForm.value = { ...h.manualOrderForm.value, action: "CONFIRM_OFFLINE_PAID", payableYuan: 90, note: "银行转账已到账，财务已核对" };
    await h.saveManualOrder();
    expect(h.confirm).toHaveBeenCalledWith(expect.stringContaining("实际收到 ¥90.00"), "确认线下收款", expect.objectContaining({ confirmButtonText: "确认已收款" }));
    expect(h.api.post).toHaveBeenCalledWith("/commerce-orders/order-1/manual-payment", {
      action: "CONFIRM_OFFLINE_PAID",
      payableCents: 9_000,
      note: "银行转账已到账，财务已核对",
      orderVersion: 2,
      idempotencyKey: "synthetic-action-key",
    });
    expect(h.detailRow.value).toMatchObject({ status: "PAID", payableCents: 9_000, version: 3 });
    expect(h.manualOrderVisible.value).toBe(false);
    expect(h.emit).toHaveBeenCalledWith("refresh");
    expect(h.ElMessage.success).toHaveBeenCalledWith("线下收款已登记，订单已标记为已支付");
  });

  it("does not expose or open the action for a non-super administrator", () => {
    const h = harness(["FINANCE"]); h.openDetail(h.order); h.openManualOrder(h.order);
    expect(h.canManuallySettleOrder.value).toBe(false);
    expect(h.manualOrderVisible.value).toBe(false);
  });

  it.each(["CREATED", "PENDING"])("does not open a form while an online payment is %s", status => {
    const h = harness();
    h.order.paymentIntents = [{ channel: "WECHAT_JSAPI", status }];
    h.openDetail(h.order); h.openManualOrder(h.order);
    expect(h.hasActiveOnlinePayment(h.order)).toBe(true);
    expect(h.manualOrderVisible.value).toBe(false);
    expect(h.api.post).not.toHaveBeenCalled();
  });

  it("closes the active provider payment first and immediately enables repricing", async () => {
    const h = harness();
    h.order.paymentIntents = [{ id: "payment-1", channel: "ALIPAY_WAP", status: "PENDING" }];
    h.openDetail(h.order);
    await h.closeOnlinePayment(h.order);
    expect(h.prompt).toHaveBeenCalledWith(expect.stringContaining("随后即可调价"), "关闭在线支付", expect.objectContaining({ confirmButtonText: "确认渠道关单" }));
    expect(h.api.post).toHaveBeenCalledWith("/commerce-orders/order-1/payments/payment-1/close", {
      note: "客户要求改价，已核对尚未付款",
      orderVersion: 2,
      idempotencyKey: "synthetic-action-key",
    });
    expect(h.detailRow.value).toMatchObject({ version: 3, paymentIntents: [expect.objectContaining({ id: "payment-1", status: "CLOSED" })] });
    h.openManualOrder(h.detailRow.value);
    expect(h.manualOrderVisible.value).toBe(true);
  });

  it("closes an unpaid order with one required note", async () => {
    const h = harness(); h.openDetail(h.order);
    await h.closeOrder(h.order);
    expect(h.api.post).toHaveBeenCalledWith("/commerce-orders/order-1/close", {
      note: "客户要求改价，已核对尚未付款",
      orderVersion: 2,
      idempotencyKey: "synthetic-action-key",
    });
    expect(h.detailRow.value).toMatchObject({ status: "CANCELLED", version: 3 });
  });

  it("requires a meaningful note and keeps the form open on a server conflict", async () => {
    const h = harness(); h.openDetail(h.order); h.openManualOrder(h.order);
    h.manualOrderForm.value.note = "x"; await h.saveManualOrder();
    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.ElMessage.error).toHaveBeenCalledWith("请填写2至500字的处理备注");
    h.manualOrderForm.value.note = "已核对线下收款";
    h.api.post.mockRejectedValueOnce(new Error("订单已更新，请刷新后重试"));
    await h.saveManualOrder();
    expect(h.manualOrderVisible.value).toBe(true);
    expect(h.ElMessage.error).toHaveBeenLastCalledWith("订单已更新，请刷新后重试");
  });

  it("renders the explicit offline channel and the safety explanation", () => {
    const h = harness();
    expect(h.paymentChannelLabel("OFFLINE_MANUAL")).toBe("线下收款");
    const source = readFileSync(new URL("./components/CommerceWorkspace.vue", import.meta.url), "utf8");
    expect(source).toContain("已有渠道支付处理中时服务端会拒绝操作");
    expect(source).toContain("在线支付处理中");
    expect(source).toContain("关闭在线支付");
    expect(source).toContain("处理备注");
    expect(source).toContain("订单详情");
    expect(source).toContain("收货电话");
    expect(source).toContain("详细地址");
    expect(source).toContain("推广上级 ID");
    expect(source).toContain("支付完成时间");
  });

  it("opens an order product in the H5 storefront without replacing the admin page", () => {
    const source = readFileSync(new URL("./components/CommerceWorkspace.vue", import.meta.url), "utf8");
    expect(source).toContain("/global/saidian-mall/#/pages/product/index?id=");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain("scope.row.items?.[0]?.productId");
    expect(source).toContain("scope.row.productId");
  });
});
