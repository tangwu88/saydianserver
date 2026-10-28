import { readFileSync } from "node:fs";
import ts from "typescript";
import { reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
function harness() {
  const source = readFileSync(
    new URL("./components/PasswordGate.vue", import.meta.url),
    "utf8",
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile(
    "gate.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const printer = ts.createPrinter();
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
    get: vi.fn(async () => ({ data: { data: { mustChangePassword: true } } })),
    post: vi.fn(async () => ({ data: { data: { token: "rotated" } } })),
  };
  const emit = vi.fn(),
    store = { setItem: vi.fn() };
  const deps = {
    ref,
    reactive,
    defineEmits: () => emit,
    api,
    data: (r: any) => r.data.data,
    errorMessage: () => "合成失败",
    partnerTokenKey: "partner",
    sessionStorage: store,
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
  };
  const state = new Function(
    ...Object.keys(deps),
    code + "\nreturn { load, save, form, required, error, loading };",
  )(...Object.values(deps));
  return { ...state, api, emit, store };
}
describe("partner password gate actions", () => {
  it("blocks the business view for initial credentials", async () => {
    const h = harness();
    await h.load();
    expect(h.required.value).toBe(true);
    expect(h.emit).not.toHaveBeenCalledWith("ready", true);
  });
  it("keeps access closed when loading the requirement fails", async () => {
    const h = harness();
    h.api.get.mockRejectedValueOnce(new Error("offline"));
    await h.load();
    expect(h.error.value).toBe("合成失败");
    expect(h.emit).not.toHaveBeenCalledWith("ready", true);
  });
  it("validates confirmation, submits, replaces token then allows the agreement gate", async () => {
    const h = harness();
    await h.load();
    Object.assign(h.form, {
      currentPassword: "synthetic-initial",
      newPassword: "synthetic-new",
      confirmPassword: "different",
    });
    await h.save();
    expect(h.api.post).not.toHaveBeenCalled();
    h.form.confirmPassword = h.form.newPassword;
    await h.save();
    expect(h.api.post).toHaveBeenCalledWith("/auth/change-password", {
      currentPassword: "synthetic-initial",
      newPassword: "synthetic-new",
      confirmPassword: "synthetic-new",
    });
    expect(h.store.setItem).toHaveBeenCalledWith("partner", "rotated");
    expect(h.form.currentPassword).toBe("");
    expect(h.form.newPassword).toBe("");
    expect(h.emit).toHaveBeenCalledWith("ready", true);
  });
  it("does not dismiss the gate after server rejection", async () => {
    const h = harness();
    await h.load();
    Object.assign(h.form, {
      currentPassword: "synthetic-initial",
      newPassword: "synthetic-new",
      confirmPassword: "synthetic-new",
    });
    h.api.post.mockRejectedValueOnce(new Error("incorrect password"));
    await h.save();
    expect(h.required.value).toBe(true);
    expect(h.store.setItem).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalledWith("ready", true);
  });
});
