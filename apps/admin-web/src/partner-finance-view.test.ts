import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import axios from "axios";
import { canAdminResource } from "@saydian/app-contracts";
import {
  partnerAccountErrors,
  partnerAccountFields,
} from "./partner-account-form";
const response = (value: any) => ({ data: { data: value } });
function harness(roles = ["SUPER_ADMIN"]) {
  const source = readFileSync(
    new URL("./views/PartnersView.vue", import.meta.url),
    "utf8",
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile(
      "view.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
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
        path === "/partner-levels"
          ? []
          : path.endsWith("/wallet")
            ? { balanceCents: 100, depositCents: 0 }
            : { items: [{ id: "partner-A", name: "合成伙伴A" }], total: 31 },
      ),
    ),
    post: vi.fn(async () => response({})),
    patch: vi.fn(),
  };
  const confirm = vi.fn(async () => true),
    deps = {
      computed,
      reactive,
      ref,
      onMounted: vi.fn(),
      onBeforeUnmount: vi.fn(),
      useRoute: () => ({ path: "/partner-finance" }),
      axios,
      api,
      canAdminResource,
      getAdminRoles: () => roles,
      readableError: () => "合成网络失败",
      responseData: (r: any) => r.data.data,
      ElMessage: {
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
      ElMessageBox: { confirm, prompt: vi.fn() },
      partnerAccountErrors,
      partnerAccountFields,
      crypto,
    };
  const state = new Function(
    ...Object.keys(deps),
    code +
      "\nreturn {load,loadFinance,selectFinance,backToPartners,save,form,partnerId,partners,selectedPartner,financeTab,financeOrders,page,total,pendingFunds,canFinance,dialog};",
  )(...Object.values(deps));
  return { ...state, api, confirm };
}
describe("partner financial list and quick actions", () => {
  it("loads a searchable paginated partner list by default without selecting or funding an account", async () => {
    const h = harness();
    h.page.value = 2;
    await h.load();
    expect(h.api.get).toHaveBeenCalledWith("/partners", {
      params: { search: "", page: 2 },
    });
    expect(h.total.value).toBe(31);
    expect(h.partnerId.value).toBe("");
    expect(h.api.post).not.toHaveBeenCalled();
  });
  it("targets the selected partner before opening a funding form and can inspect that partner's orders", async () => {
    const h = harness();
    await h.selectFinance({ id: "partner-B", name: "合成伙伴B" }, "balance");
    expect(h.partnerId.value).toBe("partner-B");
    expect(h.selectedPartner.value.name).toBe("合成伙伴B");
    expect(h.dialog.value).toBe(true);
    expect(h.api.post).not.toHaveBeenCalled();
    await h.selectFinance({ id: "partner-C", name: "合成伙伴C" }, "orders");
    expect(h.financeTab.value).toBe("orders");
    expect(h.api.get).toHaveBeenCalledWith(
      "/partner-finance/partner-C/orders",
      { params: { page: 1 } },
    );
  });
  it("read-only financial users cannot write even when a funding function is called directly", async () => {
    const h = harness(["FINANCE"]);
    await h.selectFinance({ id: "partner-A", name: "A" }, "balance");
    Object.assign(h.form, { amount: 100, reason: "合成测试" });
    await h.save();
    expect(h.canFinance.value).toBe(false);
    expect(h.api.post).not.toHaveBeenCalled();
  });
  it("an uncertain funding request locks the recipient and retries its original payload without a second confirmation", async () => {
    const h = harness();
    await h.selectFinance({ id: "partner-A", name: "A" }, "balance");
    Object.assign(h.form, {
      amount: 100,
      reason: "合成测试",
      referenceNo: "SYNTHETIC",
    });
    h.api.post.mockRejectedValueOnce(new Error("network uncertain"));
    await h.save();
    const pending = JSON.parse(JSON.stringify(h.pendingFunds.value));
    expect(pending.url).toBe("/partner-finance/partner-A/balance-recharge");
    await h.selectFinance({ id: "partner-B", name: "B" }, "balance");
    h.backToPartners();
    expect(h.partnerId.value).toBe("partner-A");
    Object.assign(h.form, { amount: 500, reason: "changed" });
    await h.save();
    expect(h.api.post.mock.calls[1]).toEqual([pending.url, pending.body]);
    expect(h.confirm).toHaveBeenCalledOnce();
    expect(h.pendingFunds.value).toBeUndefined();
  });
});
