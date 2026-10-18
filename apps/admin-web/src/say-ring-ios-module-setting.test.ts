import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { sayRingIosModuleDisplayOrClosed, sayRingIosModuleSettingKey, sayRingModuleKeys } from "@saydian/app-contracts";

function harness(setting: { value?: unknown; updatedAt?: string } = {}) {
  const sfc = readFileSync(new URL("./components/SayRingIosModuleSetting.vue", import.meta.url), "utf8");
  const source = ts.createSourceFile("view.ts", sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const api = { patch: vi.fn(async () => ({})), post: vi.fn(async () => ({})) }, emit = vi.fn();
  const messages = { success: vi.fn(), error: vi.fn() }, confirm = vi.fn(async () => "confirm");
  const deps = { ref, defineProps: () => ({ setting }), defineEmits: () => emit, sayRingIosModuleDisplayOrClosed, sayRingIosModuleSettingKey, sayRingModuleKeys, api, readableError: () => "保存失败", ElMessage: messages, ElMessageBox: { confirm } };
  return { ...new Function(...Object.keys(deps), code + "; return { save, value, busy };")(...Object.values(deps)), api, emit, messages, confirm, sfc };
}
describe("module setting editor", () => {
  it("starts hidden and edits each boolean without mutating source or other settings", async () => {
    const source = sayRingIosModuleDisplayOrClosed(), h = harness({ value: source });
    expect(h.value.value).toEqual(source);
    h.value.value.modules.health_library = true;
    expect(source.modules.health_library).toBe(false); expect(h.value.value.modules.mall).toBe(false);
    await h.save();
    expect(h.api.patch).toHaveBeenCalledExactlyOnceWith(`/settings/${sayRingIosModuleSettingKey}`, { value: h.value.value, expectedUpdatedAt: null, public: true });
    expect(h.emit).toHaveBeenCalledWith("saved");
    expect(h.sfc).toContain("不开放购买、支付");
  });
  it("confirms rollback using only the module revision, and handles cancellation/conflict", async () => {
    const h = harness({ updatedAt: "2026-10-18T00:00:00.000Z" });
    h.confirm.mockRejectedValueOnce(new Error("cancel")); await h.save(true);
    expect(h.api.post).not.toHaveBeenCalled();
    await h.save(true);
    expect(h.api.post).toHaveBeenCalledExactlyOnceWith(`/settings/${sayRingIosModuleSettingKey}/rollback`, expect.objectContaining({ expectedUpdatedAt: "2026-10-18T00:00:00.000Z" }));
    const f = harness(); f.api.patch.mockRejectedValueOnce(new Error("conflict")); await f.save();
    expect(f.messages.error).toHaveBeenCalledWith("保存失败"); expect(f.emit).not.toHaveBeenCalled(); expect(f.busy.value).toBe(false);
  });
});
