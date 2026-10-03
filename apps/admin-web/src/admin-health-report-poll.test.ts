import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const pendingReport = {
  id: "synthetic-report",
  status: "generating",
  reportType: "sleep",
};
const response = (data: unknown) => ({ data: { data } });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
function harness() {
  const source = readFileSync(
    new URL("./components/AdminHealthReportDialog.vue", import.meta.url),
    "utf8",
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile(
    "dialog.ts",
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
  const props = reactive({
    modelValue: true,
    row: { id: "synthetic-report" },
    canEdit: false,
  });
  const api = {
    get: vi.fn(async (..._args: any[]): Promise<any> =>
      response(pendingReport),
    ),
    patch: vi.fn(),
  };
  let session: string | null = "synthetic-session";
  const onBeforeUnmount = vi.fn();
  const watch = vi.fn();
  const deps = {
    computed,
    ref,
    onBeforeUnmount,
    watch,
    defineProps: () => props,
    defineEmits: () => vi.fn(),
    api,
    adminSessionKey: () => session,
    responseData: (r: any) => r.data.data,
    readableError: () => "合成请求失败",
    ElMessage: {},
    ElMessageBox: {},
  };
  const h = new Function(
    ...Object.keys(deps),
    code + "\nreturn {load,reset,report,loading,pausedPolling,statusLabel};",
  )(...Object.values(deps));
  return {
    ...h,
    props,
    api,
    onBeforeUnmount,
    watch,
    setSession: (value: string | null) => {
      session = value;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("audited sleep report readonly polling", () => {
  it("reads until ready without an upload or a new report", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.load();
    h.api.get.mockResolvedValueOnce(
      response({ ...pendingReport, status: "ready" }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.report.value.status).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
    expect(h.api.patch).not.toHaveBeenCalled();
  });
  it("shows retry state, bounds polling, and allows manual readonly refresh", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.api.get.mockResolvedValue(
      response({ ...pendingReport, status: "queued", generationAttempts: 2 }),
    );
    await h.load();
    expect(h.statusLabel.value).toBe("等待自动重试");
    await vi.advanceTimersByTimeAsync(450_000);
    expect(h.pausedPolling.value).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await h.load(true);
    expect(h.pausedPolling.value).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    h.onBeforeUnmount.mock.calls[0][0]();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels and discards a late result on close or row change", async () => {
    const h = harness();
    const d = deferred<any>();
    h.api.get.mockImplementationOnce(() => d.promise);
    const read = h.load();
    h.props.modelValue = false;
    h.reset();
    d.resolve(
      response({
        ...pendingReport,
        status: "ready",
        content: { overview: "must-not-display" },
      }),
    );
    await read;
    expect(h.report.value).toBeNull();
    expect(h.loading.value).toBe(false);
    h.props.modelValue = true;
    h.props.row.id = "synthetic-other";
    await h.load();
    expect(h.report.value).toBeNull();
  });
  it("drops late data and stops when the admin session changes", async () => {
    const h = harness();
    const d = deferred<any>();
    h.api.get.mockImplementationOnce(() => d.promise);
    const read = h.load();
    h.setSession("synthetic-other");
    d.resolve(response(pendingReport));
    await read;
    expect(h.report.value).toBeNull();
    expect(h.loading.value).toBe(false);
  });
  it("does not silently poll another App's health reports", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.api.get.mockResolvedValue(
      response({ ...pendingReport, reportType: "health" }),
    );
    await h.load();
    expect(vi.getTimerCount()).toBe(0);
  });
});
