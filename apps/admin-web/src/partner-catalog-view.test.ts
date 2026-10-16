import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import {
  partnerAccountErrors,
  partnerAccountFields,
} from "./partner-account-form";

const levels = [
  { id: "level-1", active: true },
  { id: "level-disabled", active: false },
];
function validForm() {
  return {
    username: "synthetic.partner",
    name: "合成测试伙伴",
    mobile: "",
    levelId: "level-1",
    password: "abcdefghij",
  };
}
function harness() {
  const source = readFileSync(
    new URL("./views/PartnersView.vue", import.meta.url),
    "utf8",
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile(
    "partners.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const printer = ts.createPrinter();
  const code = ts.transpileModule(
    ast.statements
      .filter((node) => !ts.isImportDeclaration(node))
      .map((node) => printer.printNode(ts.EmitHint.Unspecified, node, ast))
      .join("\n"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const api = {
    post: vi.fn(async () => ({data:{data:{imported:1,skipped:0}}})),
    patch: vi.fn(async () => ({})),
    get: vi.fn(async (url: string) => ({
      data: {
        data: url === "/partner-levels" ? levels : { items: [], total: 0 },
      },
    })),
  };
  const deps = {
    computed,
    reactive,
    ref,
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
    axios,
    useRoute: () => ({ path: "/partner-prices" }),
    canAdminResource: () => true,
    getAdminRoles: () => [],
    api,
    ElMessage: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
    ElMessageBox: { confirm: vi.fn(async () => true) },
    readableError: String,
    responseData: (result: any) => result.data.data,
    partnerAccountErrors,
    partnerAccountFields,
  };
  const state = new Function(
    ...Object.keys(deps),
    `${code}\nreturn { open, save, form, levels, levelId, selectedPrices, importDialog, importLevel, importSelected, openImport, importProducts, deleteProducts, accountForm, dialog, saving, pendingFunds, partnerId, partners, funds, loadFinance };`,
  )(...Object.values(deps));
  state.levels.value = levels;
  state.accountForm.value = {
    clearValidate: vi.fn(),
    validate: vi.fn(async () => {
      if (Object.keys(partnerAccountErrors(state.form, true, levels)).length)
        throw new Error("invalid");
      return true;
    }),
  };
  state.open("account");
  Object.assign(state.form, validForm());
  state.levelId.value = "level-1"; return { ...state, api, confirm: deps.ElMessageBox.confirm };
}

describe("partner catalog admin actions", () => {
  it("saves independent names and prices under the level captured when editing, without ERP rebinding", async () => {
    const h = harness();
    h.open("price", { id: "sku-1", erpSkuId: "fixed-erp", product: { name: "原名" }, specification: "原规格", salePriceCents: 9000, price: { priceCents: 6000, updatedAt: "2026-10-16T00:00:00.000Z" } });
    Object.assign(h.form, { productName: "伙伴商品", specification: "礼盒", retailAmount: 99, amount: 50, enabled: true });
    h.levelId.value = "other-level";
    await h.save();
    expect(h.api.patch).toHaveBeenCalledWith("/partner-prices/level-1/sku-1", { productName: "伙伴商品", specification: "礼盒", retailPriceCents: 9900, priceCents: 5000, enabled: true, updatedAt: "2026-10-16T00:00:00.000Z" });
  });
  it("imports only explicitly selected source SKUs into the captured level", async () => {
    const h = harness(); h.openImport();
    h.importSelected.value = [{ id: "source-sku" }];
    h.levelId.value = "other-level";
    await h.importProducts();
    expect(h.api.post).toHaveBeenCalledWith("/partner-prices/level-1/import", { skuIds: ["source-sku"] });
    expect(h.importDialog.value).toBe(false);
  });
  it("cancels batch deletion without a write and submits CAS versions after confirmation", async () => {
    const h = harness();
    h.selectedPrices.value = [{ id: "sku-1", price: { updatedAt: "2026-10-16T00:00:00.000Z" } }];
    h.confirm.mockRejectedValueOnce("cancel"); await h.deleteProducts();
    expect(h.api.post).not.toHaveBeenCalled();
    await h.deleteProducts();
    expect(h.api.post).toHaveBeenCalledWith("/partner-prices/level-1/batch-delete", { items: [{ skuId: "sku-1", updatedAt: "2026-10-16T00:00:00.000Z" }] });
  });
});
