import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { describe, expect, it, vi } from "vitest";
import { parseGiftCardNumbers } from "@saydian/app-contracts";

function harness() {
  const sfc = readFileSync(
    new URL("./components/GiftBulkActionsDialog.vue", import.meta.url),
    "utf8",
  );
  const source = ts.createSourceFile(
    "dialog.ts",
    sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const printer = ts.createPrinter();
  const code = ts.transpileModule(
    source.statements
      .filter((s) => !ts.isImportDeclaration(s))
      .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, source))
      .join("\n"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const props = reactive<{ modelValue: boolean; action: "ACTIVATE" | "BIND" }>({
    modelValue: false,
    action: "ACTIVATE",
  });
  let session = "synthetic-a",
    roles = ["SUPER_ADMIN"],
    unmount = () => {};
  const api = {
    get: vi.fn<(...args: any[]) => Promise<any>>(),
    post: vi.fn<(...args: any[]) => Promise<any>>(),
  };
  const emit = vi.fn(),
    success = vi.fn();
  const deps = {
    ref,
    computed,
    watch,
    api,
    parseGiftCardNumbers,
    defineProps: () => props,
    defineEmits: () => emit,
    onBeforeUnmount: (fn: () => void) => {
      unmount = fn;
    },
    adminSessionKey: () => session,
    getAdminRoles: () => roles,
    responseData: (r: any) => r.data.data,
    readableError: () => "整批未处理：900",
    ElMessage: { success },
  };
  const dialog = new Function(
    ...Object.keys(deps),
    code +
      "\nreturn { input, reason, confirmed, busy, loading, error, products, productId, allowedSkuIds, submit, close };",
  )(...Object.values(deps));
  return {
    props,
    api,
    dialog,
    emit,
    success,
    unmount: () => unmount(),
    changeSession: () => {
      session = "synthetic-b";
    },
    revoke: () => {
      roles = [];
    },
  };
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function open(h: ReturnType<typeof harness>) {
  h.props.modelValue = true;
  await nextTick();
  h.dialog.input.value = "1，2\n001";
  h.dialog.reason.value = "批量处理";
  h.dialog.confirmed.value = true;
}
describe("gift bulk action dialog", () => {
  it("submits deduplicated management numbers once, confirms actual result and refreshes", async () => {
    const h = harness(),
      request = deferred();
    await open(h);
    h.api.post.mockReturnValue(request.promise);
    const result = h.dialog.submit();
    await h.dialog.submit();
    h.dialog.close();
    expect(h.api.post).toHaveBeenCalledTimes(1);
    expect(h.emit).not.toHaveBeenCalled();
    expect(h.api.post).toHaveBeenCalledWith("/commerce-gift-cards/actions", {
      action: "ACTIVATE",
      numbers: [1, 2],
      reason: "批量处理",
      downloadConfirmed: true,
    });
    request.resolve({ data: { data: { changed: 2 } } });
    await result;
    expect(h.success).toHaveBeenCalledWith("已开启2张礼品卡");
    expect(h.emit).toHaveBeenCalledWith("completed");
    h.unmount();
  });
  it("keeps input and server failure visible for correction", async () => {
    const h = harness();
    await open(h);
    h.api.post.mockRejectedValue(new Error("synthetic"));
    await h.dialog.submit();
    expect(h.dialog.input.value).toBe("1，2\n001");
    expect(h.dialog.error.value).toContain("整批未处理");
    expect(h.dialog.busy.value).toBe(false);
    expect(h.emit).not.toHaveBeenCalled();
    h.unmount();
  });
  it.each(["numbers", "reason", "confirmation", "session", "role"])(
    "blocks invalid %s before sending a mutation",
    async (invalid) => {
      const h = harness();
      await open(h);
      if (invalid === "numbers") h.dialog.input.value = "1-9";
      if (invalid === "reason") h.dialog.reason.value = "";
      if (invalid === "confirmation") h.dialog.confirmed.value = false;
      if (invalid === "session") h.changeSession();
      if (invalid === "role") h.revoke();
      await h.dialog.submit();
      expect(h.api.post).not.toHaveBeenCalled();
      h.unmount();
    },
  );
  it("loads products and sends one shared binding without activation confirmation", async () => {
    const h = harness();
    h.api.get.mockResolvedValue({
      data: {
        data: [
          {
            id: "synthetic-product",
            name: "测试商品",
            skus: [{ id: "synthetic-sku", stock: 1 }],
          },
        ],
      },
    });
    h.props.action = "BIND";
    await open(h);
    await nextTick();
    h.dialog.productId.value = "synthetic-product";
    h.dialog.allowedSkuIds.value = ["synthetic-sku"];
    h.dialog.confirmed.value = false;
    h.api.post.mockResolvedValue({ data: { data: { changed: 2 } } });
    await h.dialog.submit();
    expect(h.api.post).toHaveBeenCalledWith("/commerce-gift-cards/actions", {
      action: "BIND",
      numbers: [1, 2],
      reason: "批量处理",
      productId: "synthetic-product",
      allowedSkuIds: ["synthetic-sku"],
      expiresAt: null,
    });
    h.unmount();
  });
  it("ignores stale product loads and clears input when reopening", async () => {
    const h = harness(),
      request = deferred();
    h.api.get.mockReturnValueOnce(request.promise);
    h.props.action = "BIND";
    await open(h);
    h.props.modelValue = false;
    await nextTick();
    h.props.action = "ACTIVATE";
    h.props.modelValue = true;
    await nextTick();
    request.resolve({ data: { data: [{ id: "stale" }] } });
    await nextTick();
    await nextTick();
    expect(h.dialog.products.value).toEqual([]);
    expect(h.dialog.input.value).toBe("");
    h.unmount();
  });
  it.each(["session", "unmount"])(
    "discards late mutation feedback after %s changes",
    async (change) => {
      const h = harness(),
        request = deferred();
      await open(h);
      h.api.post.mockReturnValue(request.promise);
      const result = h.dialog.submit();
      change === "session" ? h.changeSession() : h.unmount();
      request.resolve({ data: { data: { changed: 2 } } });
      await result;
      expect(h.success).not.toHaveBeenCalled();
      expect(h.emit).not.toHaveBeenCalled();
      h.unmount();
    },
  );
});
