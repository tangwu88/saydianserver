import { readFileSync } from "node:fs";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { canAdminResource } from "@saydian/app-contracts";
import { createGlobalDownloadDraft, globalDownloadEditorToManifest, globalDownloadManifestToEditor } from "./global-download-setting";

const envelope = (items: Record<string, unknown>[] = [], total = items.length) => ({ data: { data: { items, total, page: 1, pageSize: 30 } } });
const member = {
  id: "internal-uuid", memberNo: "10001", emailMasked: "m***@example.invalid", emailVerified: false,
  emailVerificationStatus: "UNVERIFIED", mobileMasked: null, mobileVerified: false,
  mobileVerificationStatus: "NOT_PROVIDED", verificationVersion: "2026-09-11T00:00:00.000Z",
  nickname: "Test member", healthRecordCount: 0,
};

// Exercise the actual SFC logic with controlled network completion order.
function harness(roles = ["SUPER_ADMIN"]) {
  const sfc = readFileSync(new URL("./views/ResourceView.vue", import.meta.url), "utf8");
  const source = ts.createSourceFile("view.ts", sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(source.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const api = { get: vi.fn(async (..._args: any[]): Promise<any> => envelope()), patch: vi.fn(async () => ({})), post: vi.fn(async () => ({})) };
  const messages = { error: vi.fn(), success: vi.fn() };
  const prompt = vi.fn(async (..._args: any[]): Promise<any> => ({ value: "合成会员反馈核对" }));
  const confirm = vi.fn(async (..._args: any[]): Promise<any> => "confirm");
  const route = reactive({ params: { resource: "members" } });
  const watch = vi.fn();
  const onBeforeUnmount = vi.fn();
  const deps = {
    computed, ref, watch, onBeforeUnmount, useRoute: () => route, api, canAdminResource,
    getAdminRoles: () => roles, ElMessage: messages, ElMessageBox: { prompt, confirm },
    responseData: (response: any) => response.data.data,
    readableError: () => "网络不可用，请检查后重试",
    createGlobalDownloadDraft, downloadEditorToManifest: globalDownloadEditorToManifest, downloadManifestToEditor: globalDownloadManifestToEditor,
  };
  const instance = new Function(...Object.keys(deps), code + "\nreturn { load, searchMembers, changeCommercePage, viewHealth, updateMemberVerification, contactVerificationLabel, canManageMemberVerification, verificationBusy, resetResourceView, withDownloadSetting, openCreate, openEdit, save, payloadForResource, articleCategoryLabel, articleCategorySelectionValid, selectableArticleCategories, articleCategoryOptions, articleCategoriesReady, originalArticleCategoryId, rows, columns, resourceMeta, currentPage, search, dialogVisible, detailRows, form, loading, loadError, render, dialogTitle };")(...Object.values(deps));
  return { ...instance, api, messages, prompt, confirm, route, watch, onBeforeUnmount };
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

  it("shows real verification states and lets only a super administrator change them", async () => {
    const h = harness(); const row = { ...member, mobileMasked: "+86***8888", mobileVerified: true, mobileVerificationStatus: "VERIFIED" };
    expect(h.contactVerificationLabel(row, "email")).toBe("未验证");
    expect(h.contactVerificationLabel(row, "mobile")).toBe("已验证");
    h.api.patch.mockResolvedValueOnce({ data: { data: {
      ...row, emailVerified: true, emailVerificationStatus: "VERIFIED",
      emailVerifiedAt: "2026-09-11T01:00:00.000Z", verificationVersion: "2026-09-11T01:00:00.000Z",
    } } });
    await h.updateMemberVerification(row, "email", true);
    expect(h.confirm).toHaveBeenCalledOnce();
    expect(h.api.patch).toHaveBeenCalledExactlyOnceWith("/members/internal-uuid/verification", {
      channel: "email", verified: true, expectedUpdatedAt: "2026-09-11T00:00:00.000Z",
    });
    expect(row).toMatchObject({ emailVerified: true, emailVerificationStatus: "VERIFIED", verificationVersion: "2026-09-11T01:00:00.000Z" });
    expect(h.messages.success).toHaveBeenCalledWith("邮箱验证状态已更新");

    const readonly = harness(["APP_OPERATIONS"]); await readonly.updateMemberVerification({ ...member }, "email", true);
    expect(readonly.api.patch).not.toHaveBeenCalled(); expect(readonly.confirm).not.toHaveBeenCalled();
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
    const h = harness(["HEALTH_AUDITOR"]); const reason = deferred<any>(); h.prompt.mockImplementationOnce(() => reason.promise);
    const pending = h.viewHealth(member, true); h.route.params.resource = "articles"; h.resetResourceView();
    reason.resolve({ value: "合成会员反馈核对" }); await pending;
    expect(h.api.get).not.toHaveBeenCalled(); expect(h.dialogVisible.value).toBe(false);
  });

  it("keeps raw-health permission checks and audit reasons", async () => {
    const h = harness(["HEALTH_AUDITOR"]); h.api.get.mockResolvedValueOnce({ data: { data: [] } }); await h.viewHealth(member, true);
    expect(h.api.get).toHaveBeenCalledExactlyOnceWith("/members/internal-uuid/health-records", { params: { reason: "合成会员反馈核对" } });
    const readonly = harness(["READ_ONLY"]); await readonly.viewHealth(member, true);
    expect(readonly.api.get).not.toHaveBeenCalled(); expect(readonly.prompt).not.toHaveBeenCalled();
  });

  it.each([["SUPER_ADMIN"], ["HEALTH_AUDITOR", "SUPER_ADMIN"]])("lets a super administrator read raw health without a reason prompt (%j)", async (...roles) => {
    const h = harness(roles); h.api.get.mockResolvedValueOnce({ data: { data: [{ metric: "sleep" }] } });
    await h.viewHealth(member, true);
    expect(h.prompt).not.toHaveBeenCalled();
    expect(h.api.get).toHaveBeenCalledExactlyOnceWith("/members/internal-uuid/health-records", { params: {} });
    expect(h.dialogVisible.value).toBe(true); expect(h.detailRows.value).toEqual([{ metric: "sleep" }]);
  });

  it.each([false, true])("invalidates pending health reads on unmount (raw=%s)", async (raw) => {
    const h = harness(); const health = deferred<any>(); h.api.get.mockImplementationOnce(() => health.promise);
    const pending = h.viewHealth(member, raw); h.onBeforeUnmount.mock.calls[0][0]();
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

const contentCategories = [
  { id: "root-uuid", categoryNo: "1", name: "健康", parentId: null, locale: "en", enabled: true, sort: 0 },
  { id: "grandchild-uuid", categoryNo: "3", name: "步行", parentId: "child-uuid", locale: "en", enabled: true, sort: 0 },
  { id: "child-uuid", categoryNo: "2", name: "运动", parentId: "root-uuid", locale: "en", enabled: true, sort: 0 },
  { id: "disabled-uuid", categoryNo: "4", name: "旧分类", parentId: null, locale: "en", enabled: false, sort: 0 },
  { id: "other-uuid", categoryNo: "5", name: "科普", parentId: null, locale: "en", enabled: true, sort: 0 },
];

describe("content category number and association editor", () => {
  it("shows fixed readable category columns without exposing UUID or legacy fields", () => {
    const h = harness(); h.route.params.resource = "article-categories";
    expect(h.columns.value).toEqual(["categoryNo", "name", "locale", "sort", "enabled"]);
    h.rows.value = [{ ...contentCategories[0], legacyId: "old" }];
    expect(h.columns.value).not.toContain("id"); expect(h.columns.value).not.toContain("legacyId");
    expect(h.articleCategoryLabel(contentCategories[0])).toBe("健康（编号 1）");
    expect(h.articleCategoryLabel(contentCategories[3])).toContain("已停用");
  });

  it("loads fresh categories each time create or edit opens and uses safe creation defaults", async () => {
    const h = harness(); h.route.params.resource = "article-categories";
    h.api.get.mockResolvedValueOnce({ data: { data: contentCategories } }).mockResolvedValueOnce({ data: { data: [] } }).mockResolvedValueOnce({ data: { data: contentCategories } });
    await h.openCreate(); expect(h.form.value).toMatchObject({ enabled: true, sort: 0, parentId: null });
    expect(h.articleCategoryOptions.value).toHaveLength(5);
    await h.openCreate(); expect(h.articleCategoryOptions.value).toEqual([]);
    h.route.params.resource = "articles"; h.resetResourceView(); await h.openCreate();
    expect(h.form.value).toMatchObject({ status: "DRAFT", categoryId: null });
    expect(h.api.get).toHaveBeenCalledTimes(3);
    expect(h.api.get.mock.calls.every((call: unknown[]) => call[0] === "/article-categories")).toBe(true);
  });

  it("does not open or save a content form when categories fail to load or are malformed", async () => {
    const h = harness(); h.route.params.resource = "articles";
    h.api.get.mockRejectedValueOnce(new Error("category list unavailable"));
    await h.openEdit({ id: "article-uuid", categoryId: "disabled-uuid" }); await h.save();
    expect(h.dialogVisible.value).toBe(false); expect(h.articleCategoriesReady.value).toBe(false);
    expect(h.api.patch).not.toHaveBeenCalled(); expect(h.api.post).not.toHaveBeenCalled();
    h.api.get.mockResolvedValueOnce({ data: { data: { items: contentCategories } } }); await h.openCreate();
    expect(h.dialogVisible.value).toBe(false); expect(h.messages.error.mock.calls.some((call: unknown[]) => String(call[0]).includes("分类数据不完整"))).toBe(true);
  });

  it("excludes self and all known descendants from parent options and rejects forced cycles", async () => {
    const h = harness(); h.route.params.resource = "article-categories";
    h.api.get.mockResolvedValueOnce({ data: { data: contentCategories } }); await h.openEdit(contentCategories[0]);
    expect(h.selectableArticleCategories.value.map((item: any) => item.id)).toEqual(["disabled-uuid", "other-uuid"]);
    h.form.value.parentId = "grandchild-uuid"; await h.save(); expect(h.api.patch).not.toHaveBeenCalled();
    h.form.value.parentId = "root-uuid"; expect(h.articleCategorySelectionValid()).toBe(false);
    h.form.value.parentId = "other-uuid"; expect(h.articleCategorySelectionValid()).toBe(true);
    h.form.value.parentId = ""; expect(h.articleCategorySelectionValid()).toBe(true);
  });

  it("preserves an existing disabled article association while preventing new disabled selections", async () => {
    const h = harness(); h.route.params.resource = "articles";
    h.api.get.mockResolvedValueOnce({ data: { data: contentCategories } });
    await h.openEdit({ id: "article-uuid", categoryId: "disabled-uuid", title: "A", contentHtml: "<p>B</p>", status: "DRAFT", locale: "en" });
    expect(h.form.value.categoryId).toBe("disabled-uuid"); expect(h.articleCategorySelectionValid()).toBe(true);
    await h.save(); expect(h.api.patch).toHaveBeenCalledWith("/articles/article-uuid", { categoryId: "disabled-uuid", title: "A", contentHtml: "<p>B</p>", status: "DRAFT", locale: "en" });
    h.api.get.mockResolvedValueOnce({ data: { data: contentCategories } }); await h.openCreate();
    h.form.value.categoryId = "disabled-uuid"; expect(h.articleCategorySelectionValid()).toBe(false);
  });

  it("preserves disabled parents and uses explicit write fields with nullable cleared relationships", async () => {
    const h = harness(); h.route.params.resource = "article-categories";
    h.api.get.mockResolvedValueOnce({ data: { data: contentCategories } });
    await h.openEdit({ id: "other-uuid", categoryNo: "5", legacyId: "legacy-hidden", name: "科普", parentId: "disabled-uuid", enabled: true, sort: 0, locale: "en", createdAt: "old", derived: "not-a-write-field" });
    expect(h.articleCategorySelectionValid()).toBe(true);
    h.form.value.parentId = ""; await h.save();
    expect(h.api.patch).toHaveBeenCalledWith("/article-categories/other-uuid", { name: "科普", parentId: null, enabled: true, sort: 0, locale: "en" });
    expect(h.payloadForResource("articles", { id: "secret-id", categoryNo: "6", category: { id: "x" }, categoryId: "", title: "title", locale: "en", publishedAt: "2026-09-10T00:00:00Z", legacyId: "old" })).toEqual({ categoryId: null, title: "title", locale: "en", publishedAt: "2026-09-10T00:00:00Z" });
  });

  it("does not reopen a form after navigation or replace the latest edit with a slow earlier click", async () => {
    const h = harness(); h.route.params.resource = "articles"; const old = deferred<any>();
    h.api.get.mockImplementationOnce(() => old.promise);
    const pending = h.openEdit({ id: "first-article", categoryId: "root-uuid" });
    h.route.params.resource = "devices"; h.resetResourceView(); old.resolve({ data: { data: contentCategories } }); await pending;
    expect(h.dialogVisible.value).toBe(false); expect(h.articleCategoriesReady.value).toBe(false);
    h.route.params.resource = "articles"; const first = deferred<any>();
    h.api.get.mockImplementationOnce(() => first.promise).mockResolvedValueOnce({ data: { data: contentCategories } });
    const earlier = h.openEdit({ id: "first-article" }); await h.openEdit({ id: "second-article", categoryId: "other-uuid" });
    first.resolve({ data: { data: [] } }); await earlier;
    expect(h.form.value.id).toBe("second-article"); expect(h.form.value.categoryId).toBe("other-uuid");
    expect(h.articleCategoryOptions.value).toHaveLength(5);
  });
});
