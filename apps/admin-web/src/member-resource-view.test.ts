import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { canAdminResource } from "@saydian/app-contracts";
import { createGlobalDownloadDraft, globalDownloadEditorToManifest, globalDownloadManifestToEditor } from "./global-download-setting";

const envelope = (items: Record<string, unknown>[] = [], total = items.length) => ({ data: { data: { items, total, page: 1, pageSize: 30 } } });
const member = { id: "internal-uuid", memberNo: "10001", emailMasked: "m***@example.invalid", nickname: "Test member", healthRecordCount: 0 };

// Exercise the actual SFC logic with controlled network completion order.
function harness(roles = ["SUPER_ADMIN"]) {
  const sfc = readFileSync(new URL("./views/ResourceView.vue", import.meta.url), "utf8");
  const source = ts.createSourceFile("view.ts", sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(source.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const api = { get: vi.fn(async (..._args: any[]): Promise<any> => envelope()), patch: vi.fn(async () => ({})), post: vi.fn(async () => ({})) };
  const messages = { error: vi.fn(), success: vi.fn() };
  const prompt = vi.fn(async (..._args: any[]): Promise<any> => ({ value: "合成会员反馈核对" }));
  const route = reactive({ params: { resource: "members" } });
  const watch = vi.fn();
  const onBeforeUnmount = vi.fn();
  const deps = {
    computed, ref, watch, onBeforeUnmount, useRoute: () => route, api, canAdminResource,
    getAdminRoles: () => roles, ElMessage: messages, ElMessageBox: { prompt },
    responseData: (response: any) => response.data.data,
    readableError: () => "网络不可用，请检查后重试",
    createGlobalDownloadDraft, downloadEditorToManifest: globalDownloadEditorToManifest, downloadManifestToEditor: globalDownloadManifestToEditor,
  };
  const instance = new Function(...Object.keys(deps), code + "\nreturn { load, searchMembers, changeCommercePage, viewHealth, resetResourceView, withDownloadSetting, openEdit, save, rows, columns, resourceMeta, currentPage, search, dialogVisible, detailRows, form, loading, loadError, render, dialogTitle };")(...Object.values(deps));
  return { ...instance, api, messages, prompt, route, watch, onBeforeUnmount };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("international member admin list", () => {
  it("shows fixed numeric-ID columns, including on empty lists", async () => {
    const h = harness();
    expect(h.columns.value).toEqual(["memberNo", "emailMasked", "mobileMasked", "nickname", "status", "healthRecordCount", "deviceCount", "createdAt"]);
    expect(h.columns.value).not.toContain("id");
    await h.load();
    expect(h.api.get).toHaveBeenCalledExactlyOnceWith("/members", { params: { page: 1, pageSize: 30 } });
    expect(h.columns.value).toHaveLength(8); expect(h.resourceMeta.value.total).toBe(0);
  });

  it("searches and pages on the server while preserving zero counts and missing values", async () => {
    const h = harness(); h.currentPage.value = 4; h.search.value = "10001";
    h.api.get.mockResolvedValueOnce(envelope([member], 65)); await h.searchMembers();
    expect(h.api.get.mock.calls[0][1].params).toEqual({ page: 1, pageSize: 30, search: "10001" });
    expect(h.resourceMeta.value.total).toBe(65); expect(h.render(h.rows.value[0].healthRecordCount)).toBe("0");
    expect(h.render(h.rows.value[0].mobileMasked)).toBe("—");
    await h.changeCommercePage(2);
    expect(h.api.get.mock.calls[1][1].params).toEqual({ page: 2, pageSize: 30, search: "10001" });
  });

  it("does not let a slow previous search replace newer results", async () => {
    const h = harness(); const first = deferred<any>();
    h.api.get.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(envelope([member]));
    h.search.value = "old"; const initial = h.searchMembers(); h.search.value = "10001"; await h.searchMembers();
    first.resolve(envelope([{ id: "stale-result" }])); await initial;
    expect(h.rows.value.map((row: any) => row.id)).toEqual([member.id]); expect(h.loading.value).toBe(false);
  });

  it("shows failed and malformed member reads as errors rather than a successful empty list", async () => {
    const h = harness(); h.api.get.mockRejectedValueOnce(new Error("synthetic 503")); await h.load();
    expect(h.loadError.value).toContain("会员加载失败"); expect(h.resourceMeta.value).toEqual({});
    h.api.get.mockResolvedValueOnce({ data: { data: {} } }); await h.load();
    expect(h.loadError.value).toContain("会员列表响应不完整");
    await h.load(); expect(h.loadError.value).toBe(""); expect(h.resourceMeta.value.total).toBe(0);
  });

  it("ignores a failed old search after the latest search has loaded", async () => {
    const h = harness(); const old = deferred<any>(); h.api.get.mockImplementationOnce(() => old.promise);
    const initial = h.load(); await h.load(); old.reject(new Error("late failure")); await initial;
    expect(h.loadError.value).toBe(""); expect(h.messages.error).not.toHaveBeenCalled();
  });

  it("uses the internal ID for health requests while showing the member number", async () => {
    const h = harness(); h.api.get.mockResolvedValueOnce({ data: { data: [{ metric: "sleep", count: 2 }] } });
    await h.viewHealth(member, false);
    expect(h.api.get).toHaveBeenCalledExactlyOnceWith("/members/internal-uuid/health-summary", { params: {} });
    expect(h.dialogVisible.value).toBe(true); expect(h.dialogTitle.value).toContain("10001"); expect(h.dialogTitle.value).not.toContain(member.id);
    expect(h.detailRows.value).toEqual([{ metric: "sleep", count: 2 }]);
  });

  it("clears member page state on navigation and prevents a late health dialog from reopening", async () => {
    const h = harness(); const health = deferred<any>(); h.api.get.mockImplementationOnce(() => health.promise);
    h.rows.value = [member]; h.search.value = "old"; h.currentPage.value = 7;
    const pending = h.viewHealth(member, false);
    h.route.params.resource = "articles"; h.resetResourceView();
    health.resolve({ data: { data: [{ metric: "private-health" }] } }); await pending;
    expect(h.rows.value).toEqual([]); expect(h.search.value).toBe(""); expect(h.currentPage.value).toBe(1);
    expect(h.dialogVisible.value).toBe(false); expect(h.detailRows.value).toEqual([]);
  });

  it("invalidates a pending raw-health confirmation on navigation", async () => {
    const h = harness(); const reason = deferred<any>(); h.prompt.mockImplementationOnce(() => reason.promise);
    const pending = h.viewHealth(member, true); h.route.params.resource = "articles"; h.resetResourceView();
    reason.resolve({ value: "合成会员反馈核对" }); await pending;
    expect(h.api.get).not.toHaveBeenCalled(); expect(h.dialogVisible.value).toBe(false);
  });

  it("keeps raw-health permission checks and audit reasons", async () => {
    const h = harness(); h.api.get.mockResolvedValueOnce({ data: { data: [] } }); await h.viewHealth(member, true);
    expect(h.api.get).toHaveBeenCalledExactlyOnceWith("/members/internal-uuid/health-records", { params: { reason: "合成会员反馈核对" } });
    const readonly = harness(["READ_ONLY"]); await readonly.viewHealth(member, true);
    expect(readonly.api.get).not.toHaveBeenCalled(); expect(readonly.prompt).not.toHaveBeenCalled();
  });

  it("invalidates pending health reads on unmount", async () => {
    const h = harness(); const health = deferred<any>(); h.api.get.mockImplementationOnce(() => health.promise);
    const pending = h.viewHealth(member, false); h.onBeforeUnmount.mock.calls[0][0]();
    health.resolve({ data: { data: [{ metric: "sleep" }] } }); await pending;
    expect(h.dialogVisible.value).toBe(false); expect(h.detailRows.value).toEqual([]);
  });
});

describe("international settings first configuration", () => {
  it("shows unconfigured editable entries from an empty database without writing anything", async () => {
    const h = harness(); h.route.params.resource = "settings"; h.api.get.mockResolvedValueOnce({ data: { data: [] } });
    await h.load();
    expect(h.rows.value.map((row: any) => row.key)).toEqual(["global_support", "global_app_update"]);
    expect(h.rows.value.every((row: any) => row.configuration === "未配置" && row.public === false && row.updatedAt === null)).toBe(true);
    expect(h.columns.value).toEqual(["name", "configuration", "public", "updatedAt"]);
    expect(h.api.patch).not.toHaveBeenCalled(); expect(h.api.post).not.toHaveBeenCalled();
    await h.openEdit(h.rows.value[0]);
    expect(JSON.parse(h.form.value.valueText)).toEqual({ configured: false }); expect(h.form.value.public).toBe(false);
  });

  it("opens an unpublished blank update draft and cannot submit it without real release details", async () => {
    const h = harness(); h.route.params.resource = "settings";
    const rows = await h.withDownloadSetting([]); await h.openEdit(rows[1]);
    expect(h.dialogVisible.value).toBe(true); expect(h.form.value._unconfigured).toBe(true); expect(h.form.value.public).toBe(false);
    expect(h.form.value.downloadEditor.publishedAt).toBe("");
    expect(h.form.value.downloadEditor.releases.android).toMatchObject({ status: "coming_soon", versionName: "", url: "", buildNumber: undefined });
    await h.save();
    expect(h.api.patch).not.toHaveBeenCalled(); expect(h.api.post).not.toHaveBeenCalled(); expect(h.messages.error).toHaveBeenCalled();
  });

  it("keeps configured values unchanged and only fills truly missing entries", async () => {
    const h = harness();
    const existing = { key: "global_support", public: true, value: { configured: true, email: "support@example.invalid" }, updatedAt: "2026-09-10T00:00:00Z" };
    const rows = await h.withDownloadSetting([existing]);
    expect(rows[0]).toMatchObject(existing); expect(rows[0]._unconfigured).toBeUndefined();
    expect(rows[0].configuration).toBe("已公开"); expect(rows[1]._unconfigured).toBe(true);
    expect(h.api.patch).not.toHaveBeenCalled();
  });
});
