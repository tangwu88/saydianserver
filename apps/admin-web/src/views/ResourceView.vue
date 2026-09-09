<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, getAdminRoles, readableError, responseData } from "../api";
import { canAdminResource } from "@saydian/app-contracts";
import CommerceWorkspace from "../components/CommerceWorkspace.vue";
import RichTextEditor from "../components/RichTextEditor.vue";
import {
  globalDownloadEditorToManifest as downloadEditorToManifest,
  globalDownloadManifestToEditor as downloadManifestToEditor,
  createGlobalDownloadDraft,
  type DownloadManifestEditor,
} from "../global-download-setting";

type Row = Record<string, any>;
const memberColumns = ["memberNo", "emailMasked", "mobileMasked", "nickname", "status", "healthRecordCount", "deviceCount", "createdAt"];
const memberPageSize = 30;
const route = useRoute();
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const rows = ref<Row[]>([]);
const resourceMeta = ref<Row>({});
const categoryOptions = ref<Row[]>([]);
const search = ref("");
const commerceStatus = ref("");
const currentPage = ref(1);
const dialogVisible = ref(false);
const dialogTitle = ref("");
const dialogMode = ref<"edit" | "health">("edit");
const form = ref<Row>({});
const detailRows = ref<Row[]>([]);
const shipmentVisible = ref(false);
const shipmentBusy = ref(false);
const shipmentPreview = ref<Row>({});
const shipmentForm = ref({ logisticsCompany: "", trackingNo: "", quantities: {} as Record<string, number> });
const downloadPlatformOptions = [
  { key: "android", label: "Android", packageLabel: "APK" },
  { key: "ios", label: "iPhone", packageLabel: "TestFlight / App Store" },
  { key: "harmonyos", label: "HarmonyOS", packageLabel: "HAP" },
] as const;
const titles: Record<string, string> = {
  members: "会员", care: "远程关爱", warnings: "健康预警", notifications: "通知",
  devices: "设备", articles: "内容", "legal-documents": "协议", feedback: "反馈",
  "article-categories": "内容分类", settings: "客服与更新",
  integrations: "集成状态", "admin-users": "后台账号", "account-deletions": "注销任务",
  "audit-logs": "审计日志", "commerce-products": "商品", "commerce-categories": "分类装修",
  "commerce-banners": "商城首页轮播", "commerce-business-configs": "商城设置", "commerce-reviews": "商品评价",
  "commerce-orders": "订单", "commerce-after-sales": "售后退款", "commerce-coupons": "优惠券",
  "commerce-employees": "员工推广", "commerce-commissions": "奖金明细", "commerce-jobs": "ERP任务",
  payments: "支付流水", "health-reports": "健康报告", "health-report-offers": "报告方案",
  "notification-campaigns": "通知群发",
};
const fieldLabels: Record<string, string> = {
  id: "编号", memberNo: "会员编号", legacyMemberId: "旧会员编号", emailMasked: "邮箱", mobileMasked: "手机号", nickname: "昵称",
  status: "状态", healthRecordCount: "健康记录数", deviceCount: "设备数", createdAt: "创建时间",
  updatedAt: "更新时间", invitationId: "邀请编号", metric: "指标", observedAt: "记录时间",
  title: "标题", summary: "摘要", version: "版本", documentType: "协议类型", active: "启用",
  category: "分类", content: "内容", assignedTo: "负责人", key: "集成项", state: "配置状态",
  username: "账号", displayName: "显示名称", role: "角色", eventId: "事件编号",
  name: "名称", erpItemId: "ERP商品编号", orderNo: "订单号",
  paymentNo: "支付单号", amountCents: "金额（分）", priceCents: "价格（分）",
  businessType: "业务类型", channel: "渠道", offerKey: "方案标识",
  entitlement: "权益类型", creditCount: "报告次数", durationDays: "有效天数",
  scheduledAt: "计划发送时间", sentCount: "成功数", failedCount: "失败数",
  verificationStatus: "真实检测", hasSecret: "密钥已保存",
  lastError: "失败原因", attempt: "重试次数", firmware: "固件版本",
  imageUrl: "图片地址", targetUrl: "跳转地址", enabled: "启用", published: "前台展示",
  configuration: "配置状态", public: "公开",
};
const resource = computed(() => String(route.params.resource || ""));
const title = computed(() => titles[resource.value] || resource.value);
const commerceResources = [
  "commerce-products", "commerce-categories", "commerce-banners", "commerce-business-configs",
  "commerce-orders", "commerce-after-sales", "commerce-reviews", "commerce-coupons",
  "commerce-employees", "commerce-commissions", "commerce-jobs", "payments",
];
const isCommerceResource = computed(() => commerceResources.includes(resource.value));
const canWrite = computed(() => canAdminResource(getAdminRoles(), resource.value, "write"));
const canReadRawHealth = computed(() => getAdminRoles().some((role) => ["SUPER_ADMIN", "HEALTH_AUDITOR"].includes(role)));
const editable = computed(() => [
  "articles", "article-categories", "legal-documents", "settings", "integrations", "admin-users",
  "commerce-products", "commerce-categories", "commerce-orders", "commerce-after-sales",
  "commerce-banners", "commerce-business-configs", "commerce-reviews", "commerce-coupons",
  "health-report-offers", "notification-campaigns",
].includes(resource.value) && canAdminResource(getAdminRoles(), resource.value, "write"));
const createable = computed(() => [
  "articles", "article-categories", "legal-documents", "admin-users",
  "commerce-categories", "commerce-banners", "commerce-business-configs", "commerce-coupons", "health-report-offers", "notification-campaigns",
  "commerce-products",
].includes(resource.value) && canAdminResource(getAdminRoles(), resource.value, "write"));
const searchable = computed(() => ["members", "commerce-products", "commerce-orders"].includes(resource.value));
const paginatedResources = ["members", "commerce-products", "commerce-orders", "payments"];
const serverStatusResources = ["commerce-products", "commerce-orders", "commerce-after-sales", "commerce-jobs", "payments"];
const columns = computed(() => {
  if (resource.value === "members") return memberColumns;
  if (resource.value === "settings") return ["name", "configuration", "public", "updatedAt"];
  const first = rows.value[0];
  return first ? Object.keys(first)
    .filter((key) => !["passwordHash", "secretRef", "contentHtml", "valueSnapshot", "ruleSnapshot"].includes(key))
    .slice(0, 10) : [];
});

let loadRequestId = 0;
let healthRequestId = 0;

async function load(): Promise<void> {
  const requestedResource = resource.value;
  if (requestedResource === "commerce") return;
  const requestId = ++loadRequestId;
  loading.value = true;
  loadError.value = "";
  try {
    const params: Row = {
      ...(searchable.value && search.value ? { search: search.value } : {}),
      ...(paginatedResources.includes(requestedResource) ? { page: currentPage.value } : {}),
      ...(requestedResource === "members" ? { pageSize: memberPageSize } : {}),
      ...(serverStatusResources.includes(requestedResource) && commerceStatus.value
        ? { status: commerceStatus.value }
        : {}),
    };
    const response = await api.get(`/${requestedResource}`, {
      params,
    });
    const data = responseData<unknown>(response);
    const dataObject = !Array.isArray(data) && data && typeof data === "object" ? data as Row : {};
    if (requestedResource === "members" && (!Array.isArray(dataObject.items) || !Number.isSafeInteger(dataObject.total) || dataObject.total < 0)) {
      throw new Error("会员列表响应不完整，请刷新重试");
    }
    const loadedRows = Array.isArray(data) ? data as Row[] : (dataObject.items ?? []);
    const finalRows = requestedResource === "settings"
      ? await withDownloadSetting(loadedRows)
      : loadedRows;
    if (requestId !== loadRequestId || requestedResource !== resource.value) return;
    resourceMeta.value = dataObject;
    rows.value = finalRows;
    if (requestedResource === "commerce-categories") categoryOptions.value = loadedRows;
  } catch (error) {
    if (requestId === loadRequestId && requestedResource === resource.value) {
      const message = error instanceof Error && error.message === "会员列表响应不完整，请刷新重试" ? error.message : readableError(error);
      if (requestedResource === "members") {
        rows.value = [];
        resourceMeta.value = {};
        loadError.value = `会员加载失败：${message}`;
      }
      ElMessage.error(message);
    }
  } finally {
    if (requestId === loadRequestId) loading.value = false;
  }
}

async function searchMembers(): Promise<void> {
  currentPage.value = 1;
  await load();
}

async function refreshCommerce(): Promise<void> {
  currentPage.value = 1;
  await load();
}

async function changeCommercePage(page: number): Promise<void> {
  currentPage.value = page;
  await load();
}

async function changeCommerceStatus(status: string): Promise<void> {
  commerceStatus.value = status;
  currentPage.value = 1;
  if (serverStatusResources.includes(resource.value)) await load();
}

async function withDownloadSetting(loadedRows: Row[]): Promise<Row[]> {
  const definitions = [
    { key: "global_support", name: "国际版客服" },
    { key: "global_app_update", name: "国际版 App 更新" },
  ];
  return definitions.map(definition => {
    const row = loadedRows.find(item => item.key === definition.key);
    return row
      ? { ...row, name: definition.name, configuration: row.value?.configured === false ? "未配置" : row.public ? "已公开" : "未公开" }
      : { ...definition, configuration: "未配置", public: false, updatedAt: null, _unconfigured: true,
        ...(definition.key === "global_support" ? { value: { configured: false } } : {}) };
  });
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function openCreate(): Promise<void> {
  if (["commerce-products", "commerce-categories"].includes(resource.value)) await ensureCommerceCategories();
  dialogMode.value = "edit";
  dialogTitle.value = `新增${title.value}`;
  const defaults: Record<string, Row> = {
    "admin-users": { role: "READ_ONLY", roles: ["READ_ONLY"], active: true },
    "commerce-products": { source: "LOCAL", status: "DRAFT", gallery: [], tags: [], featured: false, sort: 0, skus: [{ specification: "默认规格", salePriceCents: 1, stock: 0, enabled: true }] },
    "commerce-categories": { _isNew: true, enabled: true, sort: 0 },
    "commerce-banners": { enabled: true, sort: 0 },
    "commerce-business-configs": { _isNew: true, key: "", label: "", enabled: false, valueText: "{}" },
    "commerce-coupons": { status: "DRAFT", value: 100, minimumSpendCents: 0, totalQuantity: 100 },
    "health-report-offers": { entitlement: "SINGLE_REPORT", creditCount: 1, platforms: ["android", "h5"], active: false },
    "notification-campaigns": { type: "SYSTEM", audienceAllActive: false, audienceUserIds: "" },
  };
  form.value = defaults[resource.value] ?? {};
  dialogVisible.value = true;
}

async function openEdit(row: Row): Promise<void> {
  if (["commerce-products", "commerce-categories"].includes(resource.value)) await ensureCommerceCategories();
  dialogMode.value = "edit";
  dialogTitle.value = `编辑${title.value}`;
  const nextForm: Row = {
    ...row,
    roles: Array.isArray(row.roles) && row.roles.length ? [...row.roles] : [row.role ?? "READ_ONLY"],
    skus: Array.isArray(row.skus) ? row.skus.map((sku: Row) => ({ ...sku })) : [],
    _isNew: false,
    publicConfigText: row.publicConfig ? JSON.stringify(row.publicConfig, null, 2) : "{}",
    secretsText: "",
    clearSecrets: false,
    valueText: row.value ? JSON.stringify(row.value, null, 2) : "{}",
    galleryText: Array.isArray(row.gallery) ? row.gallery.join("\n") : "",
    tagsText: Array.isArray(row.tags) ? row.tags.join("，") : "",
    platforms: Array.isArray(row.platforms) ? row.platforms : [],
    audienceAllActive: row.audience?.allActive === true,
    audienceUserIds: Array.isArray(row.audience?.userIds) ? row.audience.userIds.join("\n") : "",
  };
  if (row.key === "global_app_update") {
    try {
      nextForm.downloadEditor = row._unconfigured ? createGlobalDownloadDraft() : downloadManifestToEditor(row.value);
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "App 下载配置无法读取");
      return;
    }
  }
  form.value = nextForm;
  dialogVisible.value = true;
}

async function ensureCommerceCategories(): Promise<void> {
  if (categoryOptions.value.length) return;
  try {
    const data = responseData<unknown>(await api.get("/commerce-categories"));
    categoryOptions.value = Array.isArray(data) ? data as Row[] : [];
  } catch (error) {
    ElMessage.error(readableError(error));
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const id = String(form.value.id ?? "");
    let payload: Row = payloadForResource(resource.value, form.value);
    if (resource.value === "integrations") {
      const secretsText = String(form.value.secretsText || "").trim();
      payload = {
        state: form.value.state,
        publicConfig: JSON.parse(String(form.value.publicConfigText || "{}")),
        ...(secretsText ? { secrets: JSON.parse(secretsText) } : {}),
        ...(form.value.clearSecrets === true ? { clearSecrets: true } : {}),
      };
      await api.patch(`/integrations/${encodeURIComponent(String(form.value.key))}`, payload);
    } else if (resource.value === "settings") {
      const settingValue = form.value.key === "global_app_update"
        ? downloadEditorToManifest(form.value.downloadEditor as DownloadManifestEditor)
        : JSON.parse(String(form.value.valueText || "{}"));
      payload = {
        value: settingValue,
        public: form.value.public !== false,
      };
      await api.patch(`/settings/${encodeURIComponent(String(form.value.key))}`, payload);
    } else if (resource.value === "commerce-business-configs") {
      const configKey = String(form.value.key ?? "").trim();
      if (!configKey) throw new Error("请填写配置项标识");
      payload = {
        label: form.value.label,
        value: JSON.parse(String(form.value.valueText || "{}")),
        enabled: form.value.enabled === true,
      };
      await api.patch(`/commerce-business-configs/${encodeURIComponent(configKey)}`, payload);
    } else if (resource.value === "commerce-commissions") {
      await api.patch("/commerce-commissions/plan", pick(form.value, ["enabled", "rateBps", "settlementDays", "withdrawalEnabled", "minimumWithdrawCents", "dailyWithdrawLimitCents", "reviewRequired"]));
    } else if (id) {
      await api.patch(`/${resource.value}/${encodeURIComponent(id)}`, payload);
    } else {
      await api.post(`/${resource.value}`, payload);
    }
    ElMessage.success("已保存");
    dialogVisible.value = false;
    await load();
  } catch (error) {
    const message = readableError(error);
    ElMessage.error(message === "请求失败，请稍后重试" && error instanceof Error ? error.message : message);
  } finally { saving.value = false; }
}

function setDownloadPublishedNow(): void {
  const editor = form.value.downloadEditor as DownloadManifestEditor | undefined;
  if (editor) editor.publishedAt = new Date().toISOString();
}

function fillDownloadUrl(platform: "android" | "ios" | "harmonyos"): void {
  if (platform === "ios") return;
  const editor = form.value.downloadEditor as DownloadManifestEditor | undefined;
  const release = editor?.releases[platform];
  if (release?.fileName) release.url = `/global/down/files/${release.fileName.trim()}`;
}

function payloadForResource(current: string, source: Row): Row {
  const fields: Record<string, string[]> = {
    "commerce-products": ["displayName", "subtitle", "brand", "categoryId", "coverImage", "detailHtml", "status", "featured", "sort", "localArchived"],
    "commerce-categories": ["name", "parentId", "iconUrl", "sort", "enabled"],
    "commerce-banners": ["title", "imageUrl", "targetUrl", "sort", "enabled"],
    "commerce-reviews": ["published"],
    "commerce-orders": ["adminRemark", "version"],
    "commerce-after-sales": ["status", "returnLogisticsCompany", "returnTrackingNo", "version"],
    "commerce-coupons": ["name", "status", "value", "minimumSpendCents", "totalQuantity", "validFrom", "validUntil", "employeeDistributable", "perEmployeeLimit"],
    "health-report-offers": ["offerKey", "title", "description", "entitlement", "priceCents", "currency", "creditCount", "durationDays", "platforms", "appleProductId", "active", "effectiveFrom", "effectiveUntil"],
    "notification-campaigns": ["name", "type", "title", "body", "deepLink", "scheduledAt"],
  };
  if (current === "commerce-products") {
    return {
      ...pick(source, fields["commerce-products"]!),
      ...(source.source === "LOCAL" ? { name: source.name, ...(source.erpItemId ? { erpItemId: source.erpItemId } : {}), source: "LOCAL", skus: source.skus } : {}),
      gallery: String(source.galleryText ?? "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      tags: String(source.tagsText ?? "").split(/[,，\r\n]/).map((value) => value.trim()).filter(Boolean),
    };
  }
  if (current === "notification-campaigns") {
    return {
      ...pick(source, fields["notification-campaigns"]!),
      audience: source.audienceAllActive === true
        ? { allActive: true }
        : { userIds: String(source.audienceUserIds ?? "").split(/[，,\r\n]/).map((value) => value.trim()).filter(Boolean) },
    };
  }
  if (fields[current]) return pick(source, fields[current]);
  const payload = { ...source };
  for (const key of ["id", "createdAt", "updatedAt", "publicConfigText", "valueText", "category", "_count"]) delete payload[key];
  return payload;
}

function pick(source: Row, fields: string[]): Row {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

async function updateFeedback(row: Row, status: string): Promise<void> {
  try {
    await api.patch(`/feedback/${encodeURIComponent(String(row.id))}`, { status });
    row.status = status;
    ElMessage.success("反馈状态已更新");
  } catch (error) { ElMessage.error(readableError(error)); }
}

async function viewHealth(row: Row, raw: boolean): Promise<void> {
  if (resource.value !== "members" || (raw && !canReadRawHealth.value)) return;
  const requestId = ++healthRequestId;
  const isCurrentRequest = () => requestId === healthRequestId && resource.value === "members";
  detailRows.value = [];
  dialogVisible.value = false;
  let reason: string | undefined;
  if (raw) {
    try {
      const response = await ElMessageBox.prompt(
        "原始健康记录属于敏感信息。请填写本次查看的具体业务原因，系统将记录操作者、原因和时间。",
        "敏感数据访问确认",
        {
          type: "warning", confirmButtonText: "确认查看", cancelButtonText: "取消",
          inputPlaceholder: "例如：处理会员反馈单 #12345",
          inputValidator: (value) => value.trim().length >= 5 || "请填写至少5个字的具体原因",
        },
      );
      reason = response.value.trim();
    } catch { return; }
  }
  if (!isCurrentRequest()) return;
  try {
    const suffix = raw ? "health-records" : "health-summary";
    const data = responseData<unknown>(await api.get(`/members/${encodeURIComponent(String(row.id))}/${suffix}`, {
      params: raw ? { reason } : {},
    }));
    if (!isCurrentRequest()) return;
    detailRows.value = Array.isArray(data) ? data as Row[] : [];
    dialogMode.value = "health";
    dialogTitle.value = `${row.memberNo ?? "会员"} · ${raw ? "原始健康记录（已审计）" : "健康数据摘要"}`;
    dialogVisible.value = true;
  } catch (error) { if (isCurrentRequest()) ElMessage.error(readableError(error)); }
}

async function runAction(path: string, success: string): Promise<void> {
  try {
    await ElMessageBox.confirm("确认执行此操作？", "操作确认", { type: "warning" });
    await api.post(path);
    ElMessage.success(success);
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(readableError(error));
  }
}

async function batchProducts(ids: string[], action: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认对 ${ids.length} 件商品执行${action === "ARCHIVE" ? "归档" : action === "PUBLISH" ? "上架" : "下架"}？`, "批量操作");
    await api.post("/commerce-products/batch", { ids, action });
    ElMessage.success("商品已更新");
    await load();
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(readableError(error)); }
}

async function refundAfterSale(row: Row): Promise<void> {
  try {
    const local = Number(row.requestedCents) === 0;
    const pointText = row.pointReturnCents == null ? "待核验" : (Number(row.pointReturnCents) / 100).toFixed(2);
    const response = await ElMessageBox.prompt(
      local ? `本单现金退款为0，将本地返还积分 ${pointText}。此操作不向支付渠道发起零元退款。`
        : `本次现金原路退款 ${Number(row.requestedCents) / 100} 元（含运费 ${row.shippingRefundCents == null ? "待核验" : Number(row.shippingRefundCents) / 100} 元），渠道确认成功后返还积分 ${pointText}。受理不等于成功。`,
      local ? "结算积分" : row.type === "SHIPPING_ONLY" ? "执行已审核运费退款" : "发起退款",
      {
        type: "warning",
        inputValue: String(row.reason ?? "售后退款"),
        inputValidator: (value) => value.trim().length >= 2 || "请填写退款原因",
        confirmButtonText: "确认发起",
      },
    );
    await api.post(`/commerce-after-sales/${row.id}/refund`, { reason: response.value.trim() });
    ElMessage.success(local ? "本地积分结算已完成" : "退款请求已提交，请等待渠道结果");
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(readableError(error));
  }
}

async function openShipment(row: Row): Promise<void> {
  try {
    shipmentPreview.value = responseData<Row>(await api.get(`/commerce-orders/${encodeURIComponent(String(row.id))}/fulfillment-preview`));
    shipmentForm.value = { logisticsCompany: "", trackingNo: "", quantities: Object.fromEntries(
      (shipmentPreview.value.items ?? []).map((item: Row) => [item.orderItemId, 0]),
    ) };
    shipmentVisible.value = true;
  } catch (error) { ElMessage.error(readableError(error)); }
}

async function saveShipment(): Promise<void> {
  if (shipmentBusy.value || shipmentPreview.value.unavailableReason) return;
  const items = Object.entries(shipmentForm.value.quantities).filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const logisticsCompany = shipmentForm.value.logisticsCompany.trim();
  const trackingNo = shipmentForm.value.trackingNo.trim();
  if (!logisticsCompany || !trackingNo || !items.length) { ElMessage.warning("请填写承运公司、运单号，并选择本包裹商品数量"); return; }
  shipmentBusy.value = true;
  try {
    await api.post(`/commerce-orders/${encodeURIComponent(String(shipmentPreview.value.orderId))}/shipments`,
      { version: shipmentPreview.value.version, logisticsCompany, trackingNo, items });
    ElMessage.success("包裹已登记；物流轨迹以承运方实际结果为准");
    shipmentVisible.value = false;
    await load();
  } catch (error) { ElMessage.error(readableError(error)); }
  finally { shipmentBusy.value = false; }
}

const shippingRequestKeys = new Map<string, { signature: string; key: string }>();
async function requestShippingRefund(row: Row): Promise<void> {
  try {
    const preview = responseData<Row>(await api.get(`/commerce-orders/${encodeURIComponent(String(row.id))}/shipping-refunds/preview`));
    if (Number(preview.maximumCents) <= 0) { ElMessage.warning("已无可申请的运费或现金额度"); return; }
    const amount = await ElMessageBox.prompt(
      `剩余可申请运费 ${(Number(preview.maximumCents) / 100).toFixed(2)} 元。商品退款后不自动退运费，本申请需财务审核。`, "申请单独退运费",
      { inputValue: (Number(preview.maximumCents) / 100).toFixed(2), inputPattern: /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, inputErrorMessage: "请填写最多两位小数的正金额" });
    const [whole, fraction = ""] = amount.value.trim().split(".");
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > Number(preview.maximumCents)) throw new Error("金额超过可申请额度");
    const reason = await ElMessageBox.prompt("请填写单独退运费的审批依据", "退运费原因",
      { inputValidator: value => value.trim().length >= 2 && value.trim().length <= 256 || "请填写2至256字原因" });
    const signature = JSON.stringify([amountCents, reason.value.trim()]);
    const cached = shippingRequestKeys.get(String(row.id));
    const key = cached?.signature === signature ? cached.key : crypto.randomUUID();
    shippingRequestKeys.set(String(row.id), { signature, key });
    await api.post(`/commerce-orders/${encodeURIComponent(String(row.id))}/shipping-refunds`,
      { amountCents, reason: reason.value.trim(), orderVersion: preview.orderVersion, requestKey: key });
    shippingRequestKeys.delete(String(row.id));
    ElMessage.success("运费申请已提交，请到售后退款中审核后执行");
    await load();
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(readableError(error));
  }
}

function resetResourceView(): void {
  ++loadRequestId;
  ++healthRequestId;
  loading.value = false;
  loadError.value = "";
  rows.value = [];
  resourceMeta.value = {};
  search.value = "";
  commerceStatus.value = "";
  currentPage.value = 1;
  dialogVisible.value = false;
  detailRows.value = [];
  form.value = {};
}

watch(resource, async () => {
  resetResourceView();
  await load();
}, { immediate: true });

onBeforeUnmount(() => { ++loadRequestId; ++healthRequestId; });
</script>

<template>
  <section class="page">
    <h1 class="page-title">{{ title }}</h1>
    <div class="resource-content">
      <CommerceWorkspace
        v-if="isCommerceResource"
        v-model:search="search"
        :resource="resource"
        :rows="rows"
        :meta="resourceMeta"
        :loading="loading"
        :createable="createable"
        @refresh="refreshCommerce"
        @page-change="changeCommercePage"
        @status-change="changeCommerceStatus"
        @create="openCreate"
        @edit="openEdit"
        @refund="refundAfterSale"
        @ship="openShipment"
        @shipping-refund="requestShippingRefund"
        @run-action="runAction"
        @batch-products="batchProducts"
      />
      <template v-else>
        <div class="toolbar">
          <el-input v-if="searchable" v-model="search" placeholder="邮箱、会员编号、手机号或昵称" clearable style="width: 300px" @keyup.enter="searchMembers" @clear="searchMembers" />
          <el-button v-if="resource === 'members'" :loading="loading" @click="searchMembers">搜索</el-button>
          <el-button type="primary" @click="load">刷新</el-button>
          <el-button v-if="createable" @click="openCreate">新增</el-button>
          <span class="muted">敏感字段已在服务端脱敏；无权限时不会返回原始健康数据。</span>
        </div>
        <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
        <el-table v-if="!loadError" v-loading="loading" :data="rows" border stripe :empty-text="resource === 'members' ? (loading ? '正在加载会员…' : search ? '未找到匹配会员，请检查搜索条件' : '暂无会员') : '暂无记录'">
          <el-table-column v-for="column in columns" :key="column" :prop="column" :label="fieldLabels[column] || column" min-width="145" show-overflow-tooltip>
            <template #default="scope">{{ render(scope.row[column]) }}</template>
          </el-table-column>
          <el-table-column v-if="resource === 'members'" label="健康数据" width="230" fixed="right">
            <template #default="scope">
              <el-button size="small" @click="viewHealth(scope.row, false)">查看摘要</el-button>
              <el-button v-if="canReadRawHealth" size="small" type="warning" plain @click="viewHealth(scope.row, true)">原始记录</el-button>
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite && resource === 'feedback'" label="处理" width="170" fixed="right">
            <template #default="scope">
              <el-select :model-value="scope.row.status" size="small" @change="(value: string) => updateFeedback(scope.row, value)">
                <el-option label="待处理" value="OPEN" /><el-option label="处理中" value="IN_PROGRESS" />
                <el-option label="已解决" value="RESOLVED" /><el-option label="已关闭" value="CLOSED" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column v-if="editable || (canWrite && resource === 'health-reports')" label="操作" min-width="110" fixed="right">
            <template #default="scope">
              <el-button v-if="editable" size="small" @click="openEdit(scope.row)">编辑</el-button>
              <el-button v-if="canWrite && resource === 'health-reports' && scope.row.status === 'FAILED'" size="small" type="warning" @click="runAction(`/health-reports/${scope.row.id}/retry`, '报告已重新排队')">重试</el-button>
              <el-button v-if="canWrite && resource === 'notification-campaigns' && scope.row.status === 'DRAFT'" size="small" type="primary" @click="runAction(`/notification-campaigns/${scope.row.id}/schedule`, '通知已安排发送')">安排发送</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="resource === 'members' && !loadError"
          :current-page="currentPage"
          :page-size="memberPageSize"
          :total="Number(resourceMeta.total ?? 0)"
          :disabled="loading"
          layout="total, prev, pager, next"
          style="margin-top: 16px"
          @current-change="changeCommercePage"
        />
      </template>
    </div>

    <el-dialog v-model="shipmentVisible" title="本地商品分包发货" width="min(860px, 94vw)" :close-on-click-modal="false" destroy-on-close>
      <el-alert v-if="shipmentPreview.unavailableReason" :title="shipmentPreview.unavailableReason" type="warning" :closable="false" />
      <p>只登记实际交运的包裹，可分多次发货。ERP 或售后归属不明确的订单需先核验。</p>
      <el-table :data="shipmentPreview.items ?? []" border>
        <el-table-column label="商品 / 规格" min-width="150"><template #default="scope"><div>{{ scope.row.name }}</div><small class="muted">{{ scope.row.specification || '规格未获取' }}</small></template></el-table-column>
        <el-table-column prop="quantity" label="购买" width="65" />
        <el-table-column prop="shippedQuantity" label="已发" width="65" />
        <el-table-column prop="afterSaleReservedQuantity" label="售后占用" width="90" />
        <el-table-column prop="refundedQuantity" label="已退" width="65" />
        <el-table-column prop="remainingQuantity" label="可发" width="65" />
        <el-table-column label="本包裹数量" width="175"><template #default="scope"><el-input-number v-model="shipmentForm.quantities[scope.row.orderItemId]" :min="0" :max="scope.row.remainingQuantity" :precision="0" :disabled="!!shipmentPreview.unavailableReason || shipmentBusy" /></template></el-table-column>
      </el-table>
      <el-form label-width="90px" style="margin-top: 20px">
        <el-form-item label="承运公司"><el-input v-model="shipmentForm.logisticsCompany" maxlength="60" placeholder="填写实际承运公司" :disabled="shipmentBusy" /></el-form-item>
        <el-form-item label="运单号"><el-input v-model="shipmentForm.trackingNo" maxlength="100" placeholder="填写实际运单号；同单号重复提交不会重复登记" :disabled="shipmentBusy" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="shipmentBusy" @click="shipmentVisible = false">关闭</el-button><el-button type="primary" :loading="shipmentBusy" :disabled="!!shipmentPreview.unavailableReason" @click="saveShipment">登记包裹</el-button></template>
    </el-dialog>
    <el-dialog v-model="dialogVisible" :title="dialogTitle" :width="resource === 'settings' && form.key === 'global_app_update' ? '980px' : '720px'" destroy-on-close>
      <el-table v-if="dialogMode === 'health'" :data="detailRows" border max-height="520" empty-text="暂无记录">
        <el-table-column v-for="column in Object.keys(detailRows[0] || {}).slice(0, 9)" :key="column" :label="fieldLabels[column] || column" min-width="145">
          <template #default="scope">{{ render(scope.row[column]) }}</template>
        </el-table-column>
      </el-table>
      <el-form v-else label-width="110px">
        <template v-if="resource === 'commerce-commissions'">
          <el-alert title="奖金规则只影响新支付订单；已有奖金使用原快照。提现仅可使用可用余额，仍需财务人工审核。" type="info" :closable="false" />
          <el-form-item label="启用奖金"><el-switch v-model="form.enabled" /></el-form-item>
          <el-form-item label="奖金比例"><el-input-number v-model="form.rateBps" :min="0" :max="10000" :precision="0" /><span class="muted">基点（100 = 1%）</span></el-form-item>
          <el-form-item label="收货等待天数"><el-input-number v-model="form.settlementDays" :min="0" :max="3650" :precision="0" /></el-form-item>
          <el-form-item label="启用提现"><el-switch v-model="form.withdrawalEnabled" /></el-form-item>
          <el-form-item label="最低提现（分）"><el-input-number v-model="form.minimumWithdrawCents" :min="1" :precision="0" placeholder="未配置时无法提现" /></el-form-item>
          <el-form-item label="每日额度（分）"><el-input-number v-model="form.dailyWithdrawLimitCents" :min="1" :precision="0" placeholder="不填则无额外限制" /></el-form-item>
          <el-form-item label="人工审核"><el-switch v-model="form.reviewRequired" disabled /></el-form-item>
        </template>
        <template v-else-if="resource === 'articles'">
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="摘要"><el-input v-model="form.summary" type="textarea" /></el-form-item>
          <el-form-item label="分类编号"><el-input v-model="form.categoryId" /></el-form-item>
          <el-form-item label="封面地址"><el-input v-model="form.coverUrl" /></el-form-item>
          <el-form-item label="正文"><RichTextEditor v-model="form.contentHtml" /></el-form-item>
          <el-form-item label="状态"><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="已发布" value="PUBLISHED" /></el-select></el-form-item>
        </template>
        <template v-else-if="resource === 'article-categories'">
          <el-form-item label="分类名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="上级编号"><el-input v-model="form.parentId" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        </template>
        <template v-else-if="resource === 'legal-documents'">
          <el-form-item label="协议类型"><el-input v-model="form.documentType" /></el-form-item>
          <el-form-item label="版本"><el-input v-model="form.version" /></el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="正文"><el-input v-model="form.contentHtml" type="textarea" :rows="10" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-products'">
          <el-form-item label="商品来源"><el-tag>{{ form.source === 'LOCAL' ? '本地商品' : 'ERP同步商品' }}</el-tag></el-form-item>
          <el-form-item label="商品编号"><el-input v-model="form.erpItemId" :disabled="form.source !== 'LOCAL'" placeholder="留空自动生成" /></el-form-item>
          <el-form-item label="商品名称"><el-input v-model="form.name" :disabled="form.source !== 'LOCAL'" /></el-form-item>
          <el-form-item label="展示名称"><el-input v-model="form.displayName" /></el-form-item>
          <el-form-item label="副标题"><el-input v-model="form.subtitle" /></el-form-item>
          <el-form-item label="品牌"><el-input v-model="form.brand" /></el-form-item>
          <el-form-item label="商城分类"><el-select v-model="form.categoryId" clearable filterable placeholder="请选择分类"><el-option v-for="item in categoryOptions" :key="item.id" :label="item.parent?.name ? `${item.parent.name} / ${item.name}` : item.name" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="封面地址"><el-input v-model="form.coverImage" /></el-form-item>
          <el-form-item label="相册地址"><el-input v-model="form.galleryText" type="textarea" :rows="4" placeholder="每行一个图片地址" /></el-form-item>
          <el-form-item label="标签"><el-input v-model="form.tagsText" placeholder="多个标签用逗号分隔" /></el-form-item>
          <el-form-item label="商品详情"><RichTextEditor v-model="form.detailHtml" /></el-form-item>
          <el-form-item v-if="form.source === 'LOCAL'" label="商品规格">
            <div style="width: 100%">
              <el-table :data="form.skus" border>
                <el-table-column label="规格"><template #default="scope"><el-input v-model="scope.row.specification" /></template></el-table-column>
                <el-table-column label="SKU编码"><template #default="scope"><el-input v-model="scope.row.erpSkuId" placeholder="自动生成" /></template></el-table-column>
                <el-table-column label="售价（分）" width="145"><template #default="scope"><el-input-number v-model="scope.row.salePriceCents" :min="1" controls-position="right" style="width:120px" /></template></el-table-column>
                <el-table-column label="库存" width="130"><template #default="scope"><el-input-number v-model="scope.row.stock" :min="0" controls-position="right" style="width:105px" /></template></el-table-column>
                <el-table-column label="启用" width="65"><template #default="scope"><el-switch v-model="scope.row.enabled" /></template></el-table-column>
              </el-table>
              <el-button style="margin-top:8px" @click="form.skus.push({ specification: '', salePriceCents: 1, stock: 0, enabled: true })">添加规格</el-button>
            </div>
          </el-form-item>
          <el-form-item label="状态"><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="在售" value="PUBLISHED" /><el-option label="下架" value="OFF_SHELF" /></el-select></el-form-item>
          <el-form-item label="首页推荐"><el-switch v-model="form.featured" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-categories'">
          <el-form-item label="分类名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="上级分类"><el-select v-model="form.parentId" clearable filterable placeholder="不选则为一级分类"><el-option v-for="item in categoryOptions.filter((item) => item.id !== form.id)" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="图标地址"><el-input v-model="form.iconUrl" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-banners'">
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="图片地址"><el-input v-model="form.imageUrl" /></el-form-item>
          <el-form-item label="跳转地址"><el-input v-model="form.targetUrl" clearable /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-business-configs'">
          <el-alert title="配置项建议按业务分组命名，例如 order.autoClose、shipping.default、invoice.default。支付和外部平台密钥请在集成中心维护。" type="info" :closable="false" show-icon />
          <el-form-item label="配置项"><el-input v-model="form.key" :disabled="!form._isNew" placeholder="如 shipping.default" /></el-form-item>
          <el-form-item label="名称"><el-input v-model="form.label" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
          <el-form-item label="配置内容"><el-input v-model="form.valueText" type="textarea" :rows="10" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-reviews'">
          <el-alert title="评价正文和评分来自真实订单，后台只控制是否在商城公开展示。" type="info" :closable="false" show-icon />
          <el-form-item label="评分"><el-input v-model="form.rating" disabled /></el-form-item>
          <el-form-item label="评价内容"><el-input v-model="form.content" type="textarea" :rows="6" disabled /></el-form-item>
          <el-form-item label="前台展示"><el-switch v-model="form.published" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-orders'">
          <el-alert title="订单、付款和履约状态由真实业务事件更新，此处只允许维护后台备注。" type="warning" :closable="false" show-icon />
          <el-form-item label="订单号"><el-input v-model="form.orderNo" disabled /></el-form-item>
          <el-form-item label="后台备注"><el-input v-model="form.adminRemark" type="textarea" :rows="6" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-after-sales'">
          <el-alert title="退款成功状态不能手工填写，只能由已验签的支付渠道回调更新。" type="warning" :closable="false" show-icon />
          <el-form-item label="处理状态"><el-select v-model="form.status"><el-option v-for="status in [...new Set([rows.find((row) => row.id === form.id)?.status, ...(form.allowedTransitions || [])])].filter(Boolean)" :key="status" :label="({APPLIED:'已申请',REVIEWING:'审核中',APPROVED:'通过',REJECTED:'拒绝',WAITING_RETURN:'等待退货',RETURNED:'已退回',CANCELLED:'已取消',REFUNDING:'退款中',COMPLETED:'已完成'} as Record<string,string>)[status] || status" :value="status" /></el-select></el-form-item>
          <el-form-item label="退货物流"><el-input v-model="form.returnLogisticsCompany" /></el-form-item>
          <el-form-item label="退货单号"><el-input v-model="form.returnTrackingNo" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-coupons'">
          <el-form-item label="优惠券名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="优惠金额（分）"><el-input-number v-model="form.value" :min="1" /></el-form-item>
          <el-form-item label="最低消费（分）"><el-input-number v-model="form.minimumSpendCents" :min="0" /></el-form-item>
          <el-form-item label="发行数量"><el-input-number v-model="form.totalQuantity" :min="1" /></el-form-item>
          <el-form-item label="生效时间"><el-date-picker v-model="form.validFrom" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" /></el-form-item>
          <el-form-item label="失效时间"><el-date-picker v-model="form.validUntil" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" /></el-form-item>
          <el-form-item label="状态"><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="启用" value="ACTIVE" /><el-option label="暂停" value="PAUSED" /><el-option label="已过期" value="EXPIRED" /></el-select></el-form-item>
          <el-form-item label="员工可分发"><el-switch v-model="form.employeeDistributable" /></el-form-item>
          <el-form-item label="员工领取上限"><el-input-number v-model="form.perEmployeeLimit" :min="0" /></el-form-item>
        </template>
        <template v-else-if="resource === 'health-report-offers'">
          <el-alert title="保存已有方案会创建新版本，不会改写已付款订单的历史价格。正式启用前还需真实支付渠道验收。" type="info" :closable="false" show-icon />
          <el-form-item label="方案标识"><el-input v-model="form.offerKey" placeholder="如 single-report" /></el-form-item>
          <el-form-item label="名称"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="说明"><el-input v-model="form.description" type="textarea" /></el-form-item>
          <el-form-item label="权益"><el-select v-model="form.entitlement"><el-option label="单次报告" value="SINGLE_REPORT" /><el-option label="30天健康会员" value="MEMBERSHIP" /></el-select></el-form-item>
          <el-form-item label="价格（分）"><el-input-number v-model="form.priceCents" :min="1" /></el-form-item>
          <el-form-item label="报告次数"><el-input-number v-model="form.creditCount" :min="1" /></el-form-item>
          <el-form-item v-if="form.entitlement === 'MEMBERSHIP'" label="有效天数"><el-input-number v-model="form.durationDays" :min="1" /></el-form-item>
          <el-form-item label="客户端"><el-checkbox-group v-model="form.platforms"><el-checkbox value="android">Android</el-checkbox><el-checkbox value="ios">iOS</el-checkbox><el-checkbox value="h5">H5</el-checkbox><el-checkbox value="mini_program">小程序</el-checkbox></el-checkbox-group></el-form-item>
          <el-form-item label="Apple商品ID"><el-input v-model="form.appleProductId" /></el-form-item>
          <el-form-item label="立即启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
        <template v-else-if="resource === 'notification-campaigns'">
          <el-alert title="此入口只发送营销通知；未主动同意营销通知的会员不会收到。订单、售后和健康预警由业务事件发送。" type="info" :closable="false" show-icon />
          <el-form-item label="任务名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="通知类型"><el-select v-model="form.type"><el-option label="系统消息" value="SYSTEM" /><el-option label="活动消息" value="ANNOUNCEMENT" /></el-select></el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="正文"><el-input v-model="form.body" type="textarea" :rows="5" /></el-form-item>
          <el-form-item label="跳转地址"><el-input v-model="form.deepLink" /></el-form-item>
          <el-form-item label="全部已同意用户"><el-switch v-model="form.audienceAllActive" /></el-form-item>
          <el-form-item v-if="!form.audienceAllActive" label="指定会员"><el-input v-model="form.audienceUserIds" type="textarea" :rows="4" placeholder="每行一个会员UUID" /></el-form-item>
          <el-form-item label="计划时间"><el-date-picker v-model="form.scheduledAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" clearable /></el-form-item>
        </template>
        <template v-else-if="resource === 'integrations'">
          <el-form-item label="集成项"><el-input v-model="form.key" disabled /></el-form-item>
          <el-form-item label="运行状态"><el-select v-model="form.state"><el-option label="未启用" value="UNCONFIGURED" /><el-option label="启用并等待真实检测" value="CONFIGURED" /><el-option label="已停用" value="DISABLED" /><el-option label="异常" value="ERROR" /></el-select></el-form-item>
          <el-form-item label="真实检测"><el-tag :type="form.verificationStatus === 'VERIFIED' ? 'success' : form.verificationStatus === 'ERROR' ? 'danger' : 'info'">{{ form.verificationStatus === 'VERIFIED' ? '已通过真实调用' : form.verificationStatus === 'PENDING' ? '尚未通过真实调用' : form.verificationStatus === 'DISABLED' ? '已停用' : '未配置' }}</el-tag></el-form-item>
          <el-form-item label="公开配置"><el-input v-model="form.publicConfigText" type="textarea" :rows="10" /></el-form-item>
          <el-form-item label="密钥状态"><el-tag :type="form.hasSecret ? 'success' : 'info'">{{ form.hasSecret ? '已安全保存' : '尚未保存' }}</el-tag></el-form-item>
          <el-form-item label="更新密钥"><el-input v-model="form.secretsText" type="password" show-password autocomplete="new-password" placeholder='填写 JSON；留空则保持原密钥，例如 {"apiKey":"..."}' /></el-form-item>
          <el-form-item label="清除密钥"><el-switch v-model="form.clearSecrets" /></el-form-item>
          <el-alert title="密钥使用主机外置主密钥加密，只能覆盖写入，不会在后台或接口中回显。修改配置会清除原检测时间；只有供应商真实调用成功后才显示已通过。" type="info" :closable="false" />
        </template>
        <template v-else-if="resource === 'settings'">
          <el-alert v-if="form._unconfigured" title="此项尚未配置。当前内容仅为本次编辑草稿，尚未保存或公开；请填写真实配置后保存。" type="info" :closable="false" show-icon />
          <el-form-item label="设置项"><el-input v-model="form.key" disabled /></el-form-item>
          <el-form-item label="公开"><el-switch v-model="form.public" /></el-form-item>
          <template v-if="form.key === 'global_app_update' && form.downloadEditor">
            <el-alert title="保存后国际版 App 会读取新配置。此处不上传安装包；Android/HarmonyOS 文件需先放入服务器国际版下载目录。" type="warning" :closable="false" show-icon />
            <el-form-item label="发布时间" class="download-published-at">
              <el-input v-model="form.downloadEditor.publishedAt" placeholder="ISO 8601，如 2026-09-06T00:00:00+08:00">
                <template #append><el-button @click="setDownloadPublishedNow">设为现在</el-button></template>
              </el-input>
            </el-form-item>
            <div class="download-setting-grid">
              <section v-for="platform in downloadPlatformOptions" :key="platform.key" class="download-platform-card">
                <header>
                  <strong>{{ platform.label }}</strong>
                  <el-tag size="small" :type="form.downloadEditor.releases[platform.key].status === 'available' ? 'success' : 'info'">
                    {{ form.downloadEditor.releases[platform.key].status === 'available' ? '可下载' : '待开放' }}
                  </el-tag>
                </header>
                <el-form-item label="版本号">
                  <el-input v-model="form.downloadEditor.releases[platform.key].versionName" placeholder="如 0.1.19" />
                </el-form-item>
                <el-form-item label="构建号">
                  <el-input-number v-model="form.downloadEditor.releases[platform.key].buildNumber" :min="1" :step="1" />
                </el-form-item>
                <el-form-item label="发布状态">
                  <el-select v-model="form.downloadEditor.releases[platform.key].status">
                    <el-option label="可下载" value="available" />
                    <el-option label="待开放" value="coming_soon" />
                  </el-select>
                </el-form-item>
                <template v-if="form.downloadEditor.releases[platform.key].status === 'available' && platform.key === 'ios'">
                  <el-form-item label="链接类型">
                    <el-select v-model="form.downloadEditor.releases.ios.destinationKind">
                      <el-option label="TestFlight" value="testflight" />
                      <el-option label="App Store" value="app_store" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="官方链接">
                    <el-input v-model="form.downloadEditor.releases.ios.url" placeholder="https://testflight.apple.com/..." />
                  </el-form-item>
                </template>
                <template v-else-if="form.downloadEditor.releases[platform.key].status === 'available'">
                  <el-form-item label="文件名">
                    <el-input v-model="form.downloadEditor.releases[platform.key].fileName" :placeholder="platform.packageLabel + ' 版本化文件名'" />
                  </el-form-item>
                  <el-form-item label="下载链接">
                    <el-input v-model="form.downloadEditor.releases[platform.key].url" placeholder="/global/down/files/文件名" />
                  </el-form-item>
                  <el-button class="download-url-button" plain @click="fillDownloadUrl(platform.key)">按文件名生成链接</el-button>
                  <el-form-item label="字节数">
                    <el-input-number v-model="form.downloadEditor.releases[platform.key].sizeBytes" :min="1" :step="1" controls-position="right" />
                  </el-form-item>
                  <el-form-item label="SHA-256">
                    <el-input v-model="form.downloadEditor.releases[platform.key].sha256" type="textarea" :rows="3" maxlength="64" show-word-limit />
                  </el-form-item>
                </template>
                <p v-else class="download-coming-note">待开放状态不会保存下载链接，前台按钮自动禁用。</p>
              </section>
            </div>
            <el-alert title="Android/HarmonyOS 只允许 /global/down/files/ 同源地址；iPhone 只允许官方 TestFlight 或 App Store HTTPS 链接。" type="info" :closable="false" />
          </template>
          <el-form-item v-else label="配置内容"><el-input v-model="form.valueText" type="textarea" :rows="12" /></el-form-item>
        </template>
        <template v-else-if="resource === 'admin-users'">
          <el-form-item label="账号"><el-input v-model="form.username" :disabled="Boolean(form.id)" /></el-form-item>
          <el-form-item label="显示名称"><el-input v-model="form.displayName" /></el-form-item>
          <el-form-item v-if="!form.id" label="初始密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
          <el-form-item label="角色"><el-select v-model="form.roles" multiple><el-option label="超级管理员" value="SUPER_ADMIN" /><el-option label="App 运营" value="APP_OPERATIONS" /><el-option label="商城运营" value="COMMERCE_OPERATIONS" /><el-option label="财务" value="FINANCE" /><el-option label="内容编辑" value="CONTENT_EDITOR" /><el-option label="客服" value="CUSTOMER_SERVICE" /><el-option label="健康数据审计员" value="HEALTH_AUDITOR" /><el-option label="集成管理员" value="INTEGRATION_ADMIN" /><el-option label="接口文档编辑" value="API_DOC_EDITOR" /><el-option label="只读" value="READ_ONLY" /></el-select></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">关闭</el-button><el-button v-if="dialogMode === 'edit'" type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </section>
</template>
