import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import { readCheckout, saveCheckout, clearCheckout } from "./checkout-recovery";
import {
  readRecharge,
  saveRecharge,
  clearRecharge,
  terminalPayment,
  channelLabel,
} from "./recharge-recovery";
import {
  addressFields,
  addressError,
  isDefiniteOrderFailure,
} from "./checkout-form";
import { safeReturnPath } from "./navigation";
import { recognizeAddress } from "./address-recognition";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: (key: string) => values.delete(key),
  };
}
const response = (data: unknown) => ({ data: { data } });
const quote = {
  lines: [
    {
      skuId: "sku",
      quantity: 1,
      name: "合成商品",
      unitPriceCents: 100,
      totalCents: 100,
    },
  ],
  payableCents: 100,
  subtotalCents: 100,
  shippingCents: 0,
  fingerprint: "a".repeat(64),
  level: "一级分销",
};
function harness(view: string, store = memoryStorage()) {
  const source = readFileSync(
    new URL(`./views/${view}.vue`, import.meta.url),
    "utf8",
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile(
      "view.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
    printer = ts.createPrinter();
  const code = ts.transpileModule(
    ast.statements
      .filter((n) => !ts.isImportDeclaration(n))
      .map((n) => printer.printNode(ts.EmitHint.Unspecified, n, ast))
      .join("\n"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const api = {
    get: vi.fn(async (path: string) =>
      response(
        path === "/auth/me"
          ? { id: "partner-A" }
          : path === "/wallet"
            ? { partnerId: "partner-A", balanceCents: 10000, depositCents: 0 }
            : path === "/products"
              ? {
                  items: [
                    {
                      id: "product",
                      name: "合成商品",
                      skus: [
                        {
                          id: "sku",
                          purchasable: true,
                          distributionPriceCents: 100,
                        },
                      ],
                    },
                  ],
                  total: 1,
                  level: "一级分销",
                }
              : path === "/payment-capabilities"
                ? { items: [{ channel: "wechat_native", enabled: true }] }
                : { items: [], total: 0 },
      ),
    ),
    post: vi.fn(async (path: string, _input?: unknown) =>
      response(path === "/quote" ? quote : {}),
    ),
  };
  const mounts: Array<() => Promise<void>> = [],
    dispose: Array<() => void> = [],
    router = { push: vi.fn(async () => {}), replace: vi.fn(async () => {}) };
  let sequence = 0;
  const deps = {
    computed,
    reactive,
    ref,
    onMounted: (fn: any) => mounts.push(fn),
    onBeforeUnmount: (fn: any) => dispose.push(fn),
    watch: vi.fn(),
    useRouter: () => router,
    useRoute: () => ({ path: "/wallet", params: {} }),
    api,
    data: (r: any) => r.data.data,
    errorMessage: () => "合成请求失败",
    requestKey: () => `synthetic-${++sequence}`,
    sessionStorage: store,
    ElMessage: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    axios,
    readCheckout,
    saveCheckout,
    clearCheckout,
    readRecharge,
    saveRecharge,
    clearRecharge,
    terminalPayment,
    channelLabel,
    addressFields,
    addressError,
    isDefiniteOrderFailure,
    recognizeAddress,
    navigator: { userAgent: "Desktop" },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  };
  const exports =
    view === "Products"
      ? "load, review, purchase, quantities, address, addressForm, submittedRequest, submitting, quoteStale, checkoutError, balance, fillAddress, undoAddress, pastedAddress, addressNotice"
      : "load, create, viewRecharge, poll, pendingInput, form, currentRecharge, payment, paymentError, pollError, paying";
  const state = new Function(
    ...Object.keys(deps),
    `${code}\nreturn {${exports}};`,
  )(...Object.values(deps));
  return { ...state, api, store, mounts, dispose, router };
}
async function readyCheckout() {
  const h = harness("Products");
  await h.mounts[0]!();
  h.quantities.sku = 1;
  await h.review();
  Object.assign(h.address, {
    recipientName: "合成收货人",
    recipientMobile: "19900000000",
    province: "测试省",
    city: "测试市",
    addressDetail: "测试地址",
  });
  h.addressForm.value = {
    validate: vi.fn(async () => true),
    clearValidate: vi.fn(),
  };
  return h;
}
function networkError(status?: number) {
  return { isAxiosError: true, response: status ? { status } : undefined };
}

describe("partner checkout recovery and user-facing failures", () => {
  it("fills pasted address without mixing the old recipient and allows undo", async () => {
    const h = await readyCheckout(),
      previous = { ...h.address };
    h.pastedAddress.value = "广东省深圳市南山区科技园路8号";
    h.fillAddress();
    expect(h.address.recipientName).toBe("");
    expect(h.address.recipientMobile).toBe("");
    expect(h.address.city).toBe("深圳市");
    expect(h.addressNotice.value).toContain("联系电话");
    h.undoAddress();
    expect({ ...h.address }).toEqual(previous);
    expect(h.api.post.mock.calls.every(([url]: [string]) => url === "/quote")).toBe(true);
  });
  it("does not change an uncertain payment or apply multiple-recipient input", async () => {
    const h = await readyCheckout(),
      previous = { ...h.address };
    h.pastedAddress.value =
      "张三 13800138000 广东省深圳市南山区测试路1号 李四13900139000";
    h.fillAddress();
    expect({ ...h.address }).toEqual(previous);
    h.pastedAddress.value = "张三 13800138000 广东省深圳市南山区测试路1号";
    h.submittedRequest.value = { idempotencyKey: "pending" };
    h.fillAddress();
    expect({ ...h.address }).toEqual(previous);
  });
  it("keeps the exact payment request after an uncertain failure, even if the form changes", async () => {
    const h = await readyCheckout();
    h.api.post.mockRejectedValueOnce(networkError());
    await h.purchase();
    const original = h.api.post.mock.calls.at(-1)![1];
    h.address.recipientName = "changed";
    h.api.post.mockResolvedValueOnce(response({ id: "order" }));
    await h.purchase();
    expect(h.api.post.mock.calls.at(-1)![1]).toEqual(original);
    expect(h.router.push).toHaveBeenCalledWith("/orders");
  });
  it("requires an updated quote after price rejection and never repeats stale payment", async () => {
    const h = await readyCheckout();
    h.api.post.mockRejectedValueOnce(networkError(409));
    await h.purchase();
    expect(h.quoteStale.value).toBe(true);
    const calls = h.api.post.mock.calls.length;
    await h.purchase();
    expect(h.api.post).toHaveBeenCalledTimes(calls);
    h.api.post.mockResolvedValueOnce(
      response({ ...quote, fingerprint: "b".repeat(64) }),
    );
    await h.review();
    expect(h.quoteStale.value).toBe(false);
  });
  it("does not pay when address validation fails, balance is insufficient, or recovery cannot be saved", async () => {
    const h = await readyCheckout();
    h.api.post.mockClear();
    h.addressForm.value.validate.mockResolvedValueOnce(false);
    await h.purchase();
    expect(h.api.post).not.toHaveBeenCalled();
    h.balance.value = 0;
    await h.purchase();
    expect(h.api.post).not.toHaveBeenCalled();
    h.balance.value = 10000;
    h.store.setItem.mockImplementation(() => {
      throw new Error("blocked storage");
    });
    await h.purchase();
    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.submitting.value).toBe(false);
    expect(h.checkoutError.value).toContain("存储");
  });
});
describe("recharge safety and recovery", () => {
  it("retains one exact request across navigation/reload after a lost response", async () => {
    const store = memoryStorage(),
      h = harness("Finance", store);
    await h.load();
    h.api.post.mockRejectedValueOnce(networkError());
    await h.create();
    const input = readRecharge(store, "partner-A")!;
    expect(input.amountCents).toBe(10000);
    const reloaded = harness("Finance", store);
    await reloaded.load();
    expect(reloaded.pendingInput.value).toEqual(input);
    reloaded.form.amount = 999;
    reloaded.api.post.mockResolvedValueOnce(
      response({
        id: "recharge",
        idempotencyKey: `partner-recharge-request:partner-A:${input.idempotencyKey}`,
        payment: { status: "pending" },
      }),
    );
    await reloaded.create();
    expect(reloaded.api.post).toHaveBeenCalledWith("/recharges", input);
    expect(readRecharge(store, "partner-A")).toBeNull();
    expect(readRecharge(store, "partner-B")).toBeNull();
  });
  it("does not submit a new recharge when the browser cannot retain its request", async () => {
    const h = harness("Finance");
    await h.load();
    h.store.setItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    await h.create();
    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.paying.value).toBe(false);
    expect(h.paymentError.value).toContain("存储");
  });
  it("keeps another partner's recovery isolated and rejects corrupted amount input", () => {
    const store = memoryStorage();
    saveRecharge(store, "partner-A", {
      amountCents: 100,
      channel: "wechat_native",
      idempotencyKey: "synthetic-key",
    });
    expect(readRecharge(store, "partner-B")).toBeNull();
    clearRecharge(store, "partner-B", "synthetic-key");
    expect(readRecharge(store, "partner-A")).not.toBeNull();
    saveRecharge(store, "partner-A", {
      amountCents: -1,
      channel: "wechat_native",
      idempotencyKey: "synthetic-key",
    });
    expect(readRecharge(store, "partner-A")).toBeNull();
  });
  it.each(["SUCCEEDED", "closed", "FAILED"])(
    "recognizes terminal payment status %s",
    (status) => expect(terminalPayment(status)).toBe(true),
  );
});
describe("input and navigation boundaries", () => {
  it("validates blank addresses and phone input before purchasing", () => {
    expect(addressError("province", "  ")).toContain("省份");
    expect(addressError("recipientMobile", "invalid")).toContain("联系电话");
    expect(addressError("recipientMobile", "19900000000")).toBe("");
  });
  it("returns only to known partner pages after login", () => {
    expect(safeReturnPath("/orders")).toBe("/orders");
    for (const path of [
      "//evil.invalid",
      "https://evil.invalid",
      "/admin/",
      "/login",
      ["/orders"],
    ])
      expect(safeReturnPath(path)).toBe("/");
  });
});
