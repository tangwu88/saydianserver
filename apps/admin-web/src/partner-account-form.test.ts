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
    post: vi.fn(async () => ({})),
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
    useRoute: () => ({ path: "/partners" }),
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
    `${code}\nreturn { open, save, form, levels, accountForm, dialog, saving, pendingFunds, partnerId, partners, funds, loadFinance };`,
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
  return { ...state, api };
}

describe("brand partner account form", () => {
  it.each([0, 7, 9, 129])("rejects %s-character passwords", (length) => {
    expect(
      partnerAccountErrors(
        { ...validForm(), password: "a".repeat(length) },
        true,
        levels,
      ).password,
    ).toBe("密码须为10至128个字符");
  });
  it.each([10, 128])(
    "accepts the %s-character boundary without altering the password",
    (length) => {
      const form = { ...validForm(), password: ` ${"a".repeat(length - 2)} ` };
      expect(partnerAccountErrors(form, true, levels)).toEqual({});
      expect(form.password.length).toBe(length);
    },
  );
  it("rejects missing or invalid account fields and inactive levels", () => {
    expect(
      partnerAccountErrors(
        {
          ...validForm(),
          username: "中文",
          name: " ",
          mobile: "a".repeat(31),
          levelId: "level-disabled",
        },
        true,
        levels,
      ),
    ).toMatchObject({
      username: expect.any(String),
      name: expect.any(String),
      mobile: expect.any(String),
      levelId: expect.any(String),
    });
    expect(
      partnerAccountErrors({ ...validForm(), levelId: "missing" }, true, levels)
        .levelId,
    ).toBeDefined();
  });
  it("edits account details without requiring a new username or password", () => {
    expect(
      partnerAccountErrors(
        { name: "伙伴", mobile: "", levelId: "level-1" },
        false,
        levels,
      ),
    ).toEqual({});
  });
  it("keeps invalid input open and sends no create request", async () => {
    const h = harness();
    h.form.password = "short";
    await h.save();
    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.dialog.value).toBe(true);
    expect(h.saving.value).toBe(false);
    expect(h.form.password).toBe("short");
  });
  it("submits valid input once and clears the saving state", async () => {
    const h = harness();
    await h.save();
    expect(h.api.post).toHaveBeenCalledExactlyOnceWith(
      "/partners",
      validForm(),
    );
    expect(h.dialog.value).toBe(false);
    expect(h.saving.value).toBe(false);
  });
  it("retries uncertain manual credit using the original partner and amount", async () => {
    const h = harness();
    h.partnerId.value = "partner-a";
    h.open("balance");
    Object.assign(h.form, {
      amount: 123.45,
      reason: "合成收款",
      referenceNo: "TEST-RECEIPT",
    });
    h.api.post.mockRejectedValueOnce(new Error("network lost"));
    await h.save();
    const original = JSON.parse(JSON.stringify(h.api.post.mock.calls[0]));
    expect(h.pendingFunds.value).toBeDefined();
    h.partnerId.value = "partner-b";
    h.form.amount = 999;
    await h.save();
    expect(h.api.post.mock.calls[1]).toEqual(original);
    expect(h.pendingFunds.value).toBeUndefined();
  });
  it("rejects a missing manual credit reason before posting", async () => {
    const h = harness();
    h.partnerId.value = "partner-a";
    h.open("balance");
    h.form.amount = 20;
    await h.save();
    expect(h.api.post).not.toHaveBeenCalled();
  });
  it("does not show a late wallet response for a newly selected partner", async () => {
    const h = harness();
    let resolveWallet!: (value: any) => void;
    h.api.get.mockImplementation(async (url: string) => {
      if (url === "/partner-finance/partner-a/wallet")
        return await new Promise((resolve) => {
          resolveWallet = resolve;
        });
      return {
        data: {
          data: url.endsWith("/wallet")
            ? { partnerId: "partner-b", balanceCents: 50 }
            : { items: [], total: 0 },
        },
      };
    });
    h.partnerId.value = "partner-a";
    const old = h.loadFinance();
    h.partnerId.value = "partner-b";
    await h.loadFinance();
    resolveWallet({
      data: { data: { partnerId: "partner-a", balanceCents: 100 } },
    });
    await old;
    expect(h.funds.value).toEqual({ partnerId: "partner-b", balanceCents: 50 });
  });
});
