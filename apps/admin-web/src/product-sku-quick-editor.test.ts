import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

function harness() {
  const source = readFileSync(new URL("./components/ProductSkuQuickEditor.vue", import.meta.url), "utf8")
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile("sku-editor.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(
    ast.statements.filter((node) => !ts.isImportDeclaration(node))
      .map((node) => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText;
  const product = {
    id: "product-1",
    source: "ERP",
    skus: [{
      id: "sku-1",
      erpSkuId: "ERP-SKU-1",
      specification: "黑色",
      salePriceCents: 149800,
      stock: 0,
      updatedAt: "2026-09-11T08:00:00.000Z",
    }],
  };
  const api = { patch: vi.fn(async () => ({ data: { data: { ...product, skus: [{ ...product.skus[0], stock: 20 }] } } })) };
  const ElMessage = { success: vi.fn(), error: vi.fn() };
  const emit = vi.fn();
  const deps = {
    computed,
    ref,
    defineProps: () => ({ product, canEdit: true }),
    defineEmits: () => emit,
    api,
    readableError: (error: unknown) => error instanceof Error ? error.message : "请求失败",
    responseData: (response: { data: { data: unknown } }) => response.data.data,
    ElMessage,
  };
  const state = new Function(
    ...Object.keys(deps),
    `${code}\nreturn { editing, saving, drafts, displayRows, startEditing, cancelEditing, saveAdjustments };`,
  )(...Object.values(deps));
  return { ...state, api, ElMessage, emit, product };
}

describe("product SKU quick editor", () => {
  it("edits in yuan and submits integer cents, stock and stale-write timestamp", async () => {
    const h = harness();
    h.startEditing();
    expect(h.drafts.value[0]).toMatchObject({ priceYuan: 1498, stock: 0 });
    h.drafts.value[0].priceYuan = 1399.5;
    h.drafts.value[0].stock = 20;
    await h.saveAdjustments();
    expect(h.api.patch).toHaveBeenCalledWith("/commerce-products/product-1/skus", {
      skus: [{ id: "sku-1", updatedAt: "2026-09-11T08:00:00.000Z", salePriceCents: 139950, stock: 20 }],
    });
    expect(h.emit).toHaveBeenCalledWith("saved", expect.objectContaining({ id: "product-1" }));
    expect(h.editing.value).toBe(false);
    expect(h.ElMessage.success).toHaveBeenCalledWith("售价和库存已更新");
  });

  it("keeps the editor open and skips the request for invalid values", async () => {
    const h = harness();
    h.startEditing();
    h.drafts.value[0].priceYuan = 0;
    await h.saveAdjustments();
    expect(h.api.patch).not.toHaveBeenCalled();
    expect(h.editing.value).toBe(true);
    expect(h.ElMessage.error).toHaveBeenCalledWith(expect.stringContaining("售价"));
  });

  it("does not write when the administrator did not change any value", async () => {
    const h = harness();
    h.startEditing();
    await h.saveAdjustments();
    expect(h.api.patch).not.toHaveBeenCalled();
    expect(h.editing.value).toBe(true);
    expect(h.ElMessage.error).toHaveBeenCalledWith("售价和库存没有变化");
  });

  it("keeps the user's values when the server rejects a stale edit", async () => {
    const h = harness();
    const conflict = Object.assign(new Error("SKU价格或库存已被更新，请刷新后重新修改"), { response: { status: 409 } });
    h.api.patch.mockRejectedValueOnce(conflict);
    h.startEditing();
    h.drafts.value[0].stock = 12;
    await h.saveAdjustments();
    expect(h.editing.value).toBe(true);
    expect(h.drafts.value[0].stock).toBe(12);
    expect(h.ElMessage.error).toHaveBeenCalledWith(expect.stringContaining("已被更新"));
  });
});
