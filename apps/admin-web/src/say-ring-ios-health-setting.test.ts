import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { sayRingIosHealthDisplayOrClosed, sayRingIosHealthSettingKey, sayRingReadOnlyMetricKeys } from "@saydian/app-contracts";

function harness(setting: { value?: unknown; updatedAt?: string } = {}) {
  const sfc = readFileSync(new URL("./components/SayRingIosHealthSetting.vue", import.meta.url), "utf8");
  const source = ts.createSourceFile("view.ts", sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const api = { patch: vi.fn(async () => ({})), post: vi.fn(async () => ({})) };
  const emit = vi.fn(), messages = { success: vi.fn(), error: vi.fn() }, confirm = vi.fn(async () => "confirm");
  const deps = { ref, defineProps: () => ({ setting }), defineEmits: () => emit, sayRingIosHealthDisplayOrClosed, sayRingIosHealthSettingKey, sayRingReadOnlyMetricKeys, api, readableError: () => "保存失败", ElMessage: messages, ElMessageBox: { confirm } };
  return { ...new Function(...Object.keys(deps), code + "; return { save, value, busy };")(...Object.values(deps)), api, emit, messages, confirm, sfc };
}
describe("independent iOS read-only editor", () => {
  it("starts closed without mutating the source setting and publishes only the fixed key", async () => {
    const source = sayRingIosHealthDisplayOrClosed(); const h = harness({ value: source });
    h.value.value.metrics.heart_rate = true;
    expect(source.metrics.heart_rate).toBe(false);
    await h.save(false);
    expect(h.api.patch).toHaveBeenCalledExactlyOnceWith(`/settings/${sayRingIosHealthSettingKey}`, { value: h.value.value, expectedUpdatedAt: null, public: true });
    expect(h.api.post).not.toHaveBeenCalled(); expect(h.emit).toHaveBeenCalledWith("saved");
    expect(h.sfc).toContain("不开放生理数据云上传");
  });
  it("confirms rollback and sends the current revision without touching AI settings", async () => {
    const revision = "2026-10-18T00:00:00.000Z"; const h = harness({ updatedAt: revision });
    await h.save(true);
    expect(h.confirm).toHaveBeenCalledOnce();
    expect(h.api.post).toHaveBeenCalledWith(`/settings/${sayRingIosHealthSettingKey}/rollback`, expect.objectContaining({ expectedUpdatedAt: revision }));
    expect(h.api.patch).not.toHaveBeenCalled();
  });
  it("does not write after cancelled rollback or report success on failure", async () => {
    const h = harness(); h.confirm.mockRejectedValueOnce(new Error("cancel"));
    await h.save(true); expect(h.api.post).not.toHaveBeenCalled();
    h.api.patch.mockRejectedValueOnce(new Error("conflict")); await h.save(false);
    expect(h.messages.error).toHaveBeenCalledWith("保存失败"); expect(h.emit).not.toHaveBeenCalled(); expect(h.busy.value).toBe(false);
  });
});
