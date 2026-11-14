import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref, watch, nextTick, reactive } from "vue";
import { describe, it, expect, vi } from "vitest";

function harness() {
  const sfc = readFileSync(new URL("./components/MemberSyncDiagnosticsDialog.vue", import.meta.url), "utf8");
  const source = ts.createSourceFile("dialog.ts", sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(source.statements.filter(s => !ts.isImportDeclaration(s)).map(s => printer.printNode(ts.EmitHint.Unspecified, s, source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const props = reactive<{ member: { id: string } | null }>({ member: null });
  const api = { get: vi.fn<(...args: any[]) => Promise<any>>() }, emit = vi.fn();
  let unmount = () => {};
  const deps = { ref, watch, api, defineProps: () => props, defineEmits: () => emit, onBeforeUnmount: (fn: () => void) => { unmount = fn; }, responseData: (r: any) => r.data.data, readableError: () => "请求失败，请重试" };
  const dialog = new Function(...Object.keys(deps), code + "\nreturn { load, close, reports, loading, error };")(...Object.values(deps));
  return { props, api, dialog, emit, unmount: () => unmount() };
}
function deferred() {
  let resolve!: (data: any) => void, reject!: (error: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const envelope = (id: string) => ({ data: { data: { reports: [{ report: { reportId: id } }] } } });

describe("member sync diagnostics request isolation", () => {
  it("never displays the previous member's late report", async () => {
    const h = harness(), a = deferred(), b = deferred();
    h.api.get.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    h.props.member = { id: "synthetic-a" }; await nextTick();
    h.props.member = { id: "synthetic-b" }; await nextTick();
    b.resolve(envelope("b")); await nextTick(); await nextTick();
    a.resolve(envelope("a")); await nextTick(); await nextTick();
    expect(h.dialog.reports.value).toEqual([{ report: { reportId: "b" } }]);
    expect(h.api.get).toHaveBeenLastCalledWith("/members/synthetic-b/sync-diagnostics");
    h.unmount();
  });
  it.each(["close", "unmount"])("discards late responses after %s", async action => {
    const h = harness(), request = deferred(); h.api.get.mockReturnValue(request.promise);
    h.props.member = { id: "synthetic-a" }; await nextTick();
    action === "close" ? h.dialog.close() : h.unmount();
    request.resolve(envelope("late")); await nextTick(); await nextTick();
    expect(h.dialog.reports.value).toEqual([]);
  });
  it("a stale error cannot replace the next member's successful result", async () => {
    const h = harness(), a = deferred();
    h.api.get.mockReturnValueOnce(a.promise).mockResolvedValueOnce(envelope("b"));
    h.props.member = { id: "synthetic-a" }; await nextTick();
    h.props.member = { id: "synthetic-b" }; await nextTick(); await nextTick();
    a.reject(new Error("synthetic")); await nextTick(); await nextTick();
    expect(h.dialog.error.value).toBe("");
    expect(h.dialog.reports.value).toEqual([{ report: { reportId: "b" } }]);
    expect(h.dialog.loading.value).toBe(false); h.unmount();
  });
});
