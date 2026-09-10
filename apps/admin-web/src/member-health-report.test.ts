import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const ready = { canGenerate: true, reasons: [], period: { from: "2026-08-11T00:00:00Z", to: "2026-09-10T00:00:00Z" }, validRecordCount: 20, distinctDays: 5, minimumDistinctDays: 3, availableCredits: 2 };
const response = (data: unknown) => ({ data: { data } });
const queued = { id: "report-1", status: "queued", memberId: "member-1" };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness() {
  const source = readFileSync(new URL("./components/MemberHealthReportPanel.vue", import.meta.url), "utf8").match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile("panel.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const props = reactive({ memberId: "member-1" }); const onBeforeUnmount = vi.fn(); const watch = vi.fn();
  const api = { get: vi.fn(async (..._args: any[]): Promise<any> => response(ready)), post: vi.fn(async (..._args: any[]): Promise<any> => response({ report: queued, reused: false })) };
  const confirm = vi.fn(async (..._args: any[]): Promise<any> => true);
  let key = 0;
  const deps = { computed, ref, onBeforeUnmount, watch, defineProps: () => props, api, ElMessageBox: { confirm }, responseData: (r: any) => r.data.data, readableError: (e: any) => e.message ?? "请求失败", crypto: { randomUUID: () => `key-${++key}` } };
  const h = new Function(...Object.keys(deps), code + "\nreturn {checkAvailability,generateReport,readReport,reset,availability,report,checking,generating,errorMessage,pausedPolling,reportStatus};")(...Object.values(deps));
  return { ...h, props, api, confirm, onBeforeUnmount, watch };
}
afterEach(() => vi.useRealTimers());

describe("member AI health report panel", () => {
  it("shows server gates and never creates when consent/configuration is unavailable", async () => {
    const h = harness(); h.api.get.mockResolvedValueOnce(response({ ...ready, canGenerate: false, reasons: [{ code: "ai_unconfigured", message: "AI 服务未配置" }, { code: "consent_required", message: "会员未同意健康分析" }] }));
    await h.checkAvailability(); await h.generateReport();
    expect(h.availability.value.reasons).toHaveLength(2); expect(h.api.post).not.toHaveBeenCalled(); expect(h.confirm).not.toHaveBeenCalled();
  });
  it("requires confirmation and keeps the same idempotency key after an uncertain submission", async () => {
    const h = harness(); await h.checkAvailability();
    h.api.post.mockRejectedValueOnce(new Error("网络超时")); await h.generateReport();
    h.api.get.mockResolvedValueOnce(response({ ...queued, status: "ready", content: { overview: "合成报告" } }));
    await h.generateReport();
    expect(h.confirm).toHaveBeenCalledTimes(2); expect(h.api.post.mock.calls[0][1]).toEqual({ memberId: "member-1", idempotencyKey: "key-1" });
    expect(h.api.post.mock.calls[1][1]).toEqual(h.api.post.mock.calls[0][1]); expect(h.report.value.content.overview).toBe("合成报告");
  });
  it("prevents duplicate click while confirmation is pending and handles cancellation without posting", async () => {
    const h = harness(); await h.checkAvailability(); const confirmation = deferred<any>(); h.confirm.mockImplementationOnce(() => confirmation.promise);
    const first = h.generateReport(); await h.generateReport(); confirmation.reject("cancel"); await first;
    expect(h.confirm).toHaveBeenCalledTimes(1); expect(h.api.post).not.toHaveBeenCalled(); expect(h.errorMessage.value).toBe("");
  });
  it("ignores availability and confirmation from a previous member", async () => {
    const h = harness(); const pending = deferred<any>(); h.api.get.mockImplementationOnce(() => pending.promise); const request = h.checkAvailability();
    h.props.memberId = "member-2"; h.reset(); pending.resolve(response(ready)); await request; expect(h.availability.value).toBeNull();
    await h.checkAvailability(); const confirmation = deferred<any>(); h.confirm.mockImplementationOnce(() => confirmation.promise); const create = h.generateReport();
    h.props.memberId = "member-3"; h.reset(); confirmation.resolve(true); await create; expect(h.api.post).not.toHaveBeenCalled();
  });
  it("reads an existing report without creating a new one and renders Chinese status", async () => {
    const h = harness(); h.api.get.mockResolvedValueOnce(response({ ...ready, latestReport: queued })).mockResolvedValueOnce(response({ ...queued, status: "ready", content: { overview: "仅供参考" } }));
    await h.checkAvailability(); expect(h.reportStatus.value).toBe("已生成"); expect(h.api.post).not.toHaveBeenCalled(); expect(h.report.value.content.overview).toBe("仅供参考");
  });
  it("rejects mismatched report ownership without displaying its content", async () => {
    const h = harness(); h.report.value = queued; h.api.get.mockResolvedValueOnce(response({ ...queued, memberId: "other-member", content: { overview: "must-not-display" } }));
    await h.readReport(); expect(h.report.value.content).toBeUndefined(); expect(h.errorMessage.value).toContain("归属不匹配");
  });
  it("does not start another report while a previous report read is pending", async () => {
    const h = harness(); await h.checkAvailability(); h.report.value = { ...queued, status: "ready" };
    const pending = deferred<any>(); h.api.get.mockImplementationOnce(() => pending.promise);
    const read = h.readReport(); await h.generateReport();
    expect(h.api.post).not.toHaveBeenCalled(); expect(h.confirm).not.toHaveBeenCalled();
    pending.resolve(response({ ...queued, status: "ready" })); await read;
  });
  it("stops pending report responses and polling when the dialog unmounts", async () => {
    vi.useFakeTimers(); const h = harness(); h.report.value = queued; h.api.get.mockResolvedValueOnce(response(queued)); await h.readReport();
    expect(vi.getTimerCount()).toBe(1); h.onBeforeUnmount.mock.calls[0][0](); expect(vi.getTimerCount()).toBe(0);
    const h2 = harness(); h2.report.value = queued; const pending = deferred<any>(); h2.api.get.mockImplementationOnce(() => pending.promise); const read = h2.readReport(); h2.onBeforeUnmount.mock.calls[0][0]();
    pending.resolve(response({ ...queued, status: "ready", content: { overview: "late" } })); await read; expect(h2.report.value.content).toBeUndefined();
  });
  it("does not turn failed or malformed availability into zero data or an enabled button", async () => {
    const h = harness(); h.api.get.mockRejectedValueOnce(new Error("条件读取失败")); await h.checkAvailability(); expect(h.availability.value).toBeNull(); expect(h.errorMessage.value).toBe("条件读取失败");
    h.api.get.mockResolvedValueOnce(response({})); await h.checkAvailability(); expect(h.availability.value).toBeNull(); await h.generateReport(); expect(h.api.post).not.toHaveBeenCalled();
  });
});
