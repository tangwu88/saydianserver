<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, getAdminRoles, readableError, responseData } from "../api";
import { canAdminResource } from "@saydian/app-contracts";
import CommerceWorkspace from "../components/CommerceWorkspace.vue";
import RichTextEditor from "../components/RichTextEditor.vue";
import MemberHealthData from "../components/MemberHealthData.vue";
import MemberHealthReportPanel from "../components/MemberHealthReportPanel.vue";
import AdminHealthReportDialog from "../components/AdminHealthReportDialog.vue";
import ContentImageField from "../components/ContentImageField.vue";
import { createGlobalDownloadDraft, createSayRingDownloadDraft, globalDownloadEditorToManifest, globalDownloadManifestToEditor, sayRingDownloadEditorToManifest, sayRingDownloadManifestToEditor, type DownloadManifestEditor } from "../global-download-setting";
import { downloadManifestToEditor as originalManifestToEditor, downloadEditorToManifest as originalEditorToManifest } from "../download-setting";
import { createLegalDocumentDraft, legalDocumentEditorFromRow, legalDocumentPayload, legalDocumentTypeLabel, legalProductForDocumentType, selectLegalDocumentProduct, selectLegalDocumentType } from "../legal-document-editor";
import { healthMetricLabel, healthRawJson, healthReadings, healthTime } from "../health-display";

type Row = Record<string, any>;
const memberColumns = ["avatarUrl", "memberNo", "promotionCode", "emailMasked", "mobile", "nickname", "referrerProfile", "pointBalanceCents", "status", "createdAt"];
const memberPageSize = 30;
const route = useRoute();
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const erpLookupBusy = ref(false);
const erpLookupError = ref("");
const rows = ref<Row[]>([]);
const resourceMeta = ref<Row>({});
const categoryOptions = ref<Row[]>([]);
const articleCategoryOptions = ref<Row[]>([]);
const articleCategoriesReady = ref(false);
const articleCategoryEditorResource = ref("");
const originalArticleCategoryId = ref<string | null>(null);
const memberReferralOptions = ref<Row[]>([]);
const search = ref("");
const commerceStatus = ref("");
const reportType = ref("");
const appProductFilter = ref("");
const currentPage = ref(1);
const dialogVisible = ref(false);
const dialogTitle = ref("");
const dialogMode = ref<"edit" | "health">("edit");
const form = ref<Row>({});
const detailRows = ref<Row[]>([]);
const healthMode = ref<"summary" | "raw">("summary");
const healthMember = ref<Row>({});
const shipmentVisible = ref(false);
const shipmentBusy = ref(false);
const shipmentPreview = ref<Row>({});
const shipmentForm = ref({
  logisticsCompany: "",
  trackingNo: "",
  quantities: {} as Record<string, number>,
});
const healthReportVisible = ref(false);
const healthReportRow = ref<Row | null>(null);
const feedbackVisible = ref(false);
const feedbackSaving = ref(false);
const feedbackForm = ref<Row>({});
const deviceDetailVisible = ref(false);
const deviceDetailLoading = ref(false);
const deviceDetail = ref<Row>({});
const deviceConnections = ref<Row[]>([]);
const deviceHistoryTab = ref("connections");
const deviceMeasurements = ref<Row[]>([]);
const deviceMeasurementsLoading = ref(false);
const deviceMeasurementsLoaded = ref(false);
const deviceMeasurementsMessage = ref("");
const deviceMeasurementPage = ref(1);
const deviceMeasurementTotal = ref(0);
const deviceMeasurementReason = ref("");
const memberDevicesVisible = ref(false);
const memberDevicesLoading = ref(false);
const memberDeviceMember = ref<Row>({});
const memberDevices = ref<Row[]>([]);
const packageUploading = ref<Record<string, boolean>>({});
const downloadPlatformOptions = [
  { key: "android", label: "Android", packageLabel: "APK" },
  { key: "ios", label: "iPhone", packageLabel: "TestFlight / App Store" },
  { key: "harmonyos", label: "HarmonyOS", packageLabel: "HAP" },
] as const;
const visibleDownloadPlatformOptions = computed(() => downloadPlatformOptions);
const appUpdateSettingKeys = new Set(["app_update", "global_app_update", "say_ring_app_update"]);
const contentProductOptions = [
  { value: "shared", label: "通用内容" },
  { value: "saidian", label: "原赛电 App" },
  { value: "saydian-global", label: "Saydian Health" },
  { value: "say-ring", label: "Say Ring" },
] as const;
const contentProductLabel = (value: unknown): string => contentProductOptions.find((item) => item.value === value)?.label ?? String(value ?? "未分类");
const settingProducts = (key: unknown): string[] => {
  const products: Record<string, string[]> = {
    global_support: ["saydian-global", "say-ring"],
    app_update: ["saidian"],
    global_app_update: ["saydian-global"],
    say_ring_app_update: ["say-ring"],
    say_ring_app_display: ["say-ring"],
    say_ring_map: ["say-ring"],
  };
  return products[String(key ?? "")] ?? [];
};
const isAppUpdateSetting = (key: unknown): boolean => appUpdateSettingKeys.has(String(key ?? ""));
const isAppDisplaySetting = (key: unknown): boolean => key === "say_ring_app_display";
const isGlobalSupportSetting = (key: unknown): boolean => key === "global_support";
const supportPhonePattern = /^\+?[0-9][0-9 -]{4,20}$/;
const supportEditorFromValue = (value: unknown): Row => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
  const legacyPhone = source.phone == null && (typeof source.configured === "number" || typeof source.configured === "string") ? String(source.configured).trim() : "";
  return {
    enabled: source.configured === true || Boolean(legacyPhone),
    phone: String(source.phone ?? legacyPhone).trim(),
    officialAccount: String(source.officialAccount ?? source.wechatOfficialAccount ?? "").trim(),
    serviceHours: String(source.serviceHours ?? "").trim(),
    message: String(source.message ?? "").trim(),
  };
};
const supportEditorToValue = (editor: Row): Row => {
  const phone = String(editor.phone ?? "").trim();
  const officialAccount = String(editor.officialAccount ?? "").trim();
  const serviceHours = String(editor.serviceHours ?? "").trim();
  const message = String(editor.message ?? "").trim();
  if (phone && !supportPhonePattern.test(phone)) throw new Error("客服电话格式无效");
  if (officialAccount.length > 64) throw new Error("微信公众号最多 64 个字符");
  if (serviceHours.length > 120) throw new Error("服务时间最多 120 个字符");
  if (message.length > 240) throw new Error("客服说明最多 240 个字符");
  if (editor.enabled === true && !phone && !officialAccount) throw new Error("启用客服前请填写客服电话或微信公众号");
  return {
    configured: editor.enabled === true,
    ...(phone ? { phone } : {}),
    ...(officialAccount ? { officialAccount } : {}),
    ...(serviceHours ? { serviceHours } : {}),
    ...(message ? { message } : {}),
  };
};
const createDownloadDraft = (key: unknown): DownloadManifestEditor => (String(key) === "say_ring_app_update" ? createSayRingDownloadDraft() : createGlobalDownloadDraft());
const downloadManifestToEditor = (key: unknown, value: unknown): DownloadManifestEditor => key === "app_update" ? originalManifestToEditor(value) : key === "say_ring_app_update" ? sayRingDownloadManifestToEditor(value) : globalDownloadManifestToEditor(value);
const downloadEditorToManifest = (key: unknown, editor: DownloadManifestEditor) => key === "app_update" ? originalEditorToManifest(editor) : key === "say_ring_app_update" ? sayRingDownloadEditorToManifest(editor) : globalDownloadEditorToManifest(editor);
const titles: Record<string, string> = {
  members: "会员",
  care: "远程关爱",
  warnings: "健康预警",
  notifications: "通知",
  devices: "设备",
  articles: "内容",
  "legal-documents": "协议",
  feedback: "反馈",
  "article-categories": "内容分类",
  settings: "客服与更新",
  integrations: "集成状态",
  "admin-users": "后台账号",
  "account-deletions": "注销任务",
  "audit-logs": "审计日志",
  "commerce-products": "商品",
  "commerce-categories": "分类装修",
  "commerce-banners": "商城首页轮播",
  "commerce-business-configs": "商城设置",
  "commerce-reviews": "商品评价",
  "commerce-orders": "订单",
  "commerce-after-sales": "售后退款",
  "commerce-coupons": "优惠券",
  "commerce-employees": "员工推广",
  "commerce-commissions": "奖金明细",
  "commerce-jobs": "ERP任务",
  payments: "支付流水",
  "health-reports": "健康报告",
  "health-report-offers": "报告方案",
  "notification-campaigns": "通知群发",
};
const fieldLabels: Record<string, string> = {
  id: "编号",
  memberNo: "会员编号",
  legacyMemberId: "旧会员编号",
  emailMasked: "邮箱",
  mobile: "手机号",
  mobileMasked: "手机号",
  avatarUrl: "头像",
  promotionCode: "推广码",
  referrerProfile: "推广上级",
  pointBalanceCents: "积分余额",
  nickname: "昵称",
  status: "状态",
  healthRecordCount: "健康记录数",
  deviceCount: "设备数",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  invitationId: "邀请编号",
  metric: "指标",
  observedAt: "记录时间",
  title: "标题",
  summary: "摘要",
  version: "版本",
  documentType: "协议类型",
  legalProduct: "所属 App",
  product: "所属 App",
  appScope: "所属 App",
  locale: "语言",
  reviewed: "已审核",
  publishedAt: "发布时间",
  active: "启用",
  category: "分类",
  content: "内容",
  memberNickname: "会员昵称",
  distinctDays: "覆盖天数",
  validRecordCount: "有效记录数",
  reportType: "报告类型",
  generatedAt: "生成时间",
  replyContent: "客服回复",
  repliedAt: "回复时间",
  assignedTo: "负责人",
  key: "集成项",
  state: "配置状态",
  username: "账号",
  displayName: "显示名称",
  bluetoothName: "蓝牙名称",
  deviceIdentifier: "设备标识",
  macAddress: "MAC 地址",
  connectedAt: "连接时间",
  role: "角色",
  eventId: "事件编号",
  name: "名称",
  erpItemId: "ERP商品编号",
  orderNo: "订单号",
  paymentNo: "支付单号",
  amountCents: "金额（分）",
  priceCents: "价格（分）",
  businessType: "业务类型",
  channel: "渠道",
  offerKey: "方案标识",
  entitlement: "权益类型",
  creditCount: "报告次数",
  durationDays: "有效天数",
  scheduledAt: "计划发送时间",
  sentCount: "成功数",
  failedCount: "失败数",
  redemptionCode: "优惠码",
  verificationStatus: "真实检测",
  hasSecret: "密钥已保存",
  lastError: "失败原因",
  attempt: "重试次数",
  firmware: "固件版本",
  vendor: "设备厂商",
  model: "设备型号",
  capabilities: "设备能力",
  boundAt: "绑定时间",
  lastSeenAt: "最近连接",
  imageUrl: "图片地址",
  targetUrl: "跳转地址",
  enabled: "启用",
  published: "前台展示",
  configuration: "配置状态",
  public: "公开",
  categoryNo: "分类编号",
  sort: "排序",
};
const resource = computed(() => String(route.params.resource || ""));
const needsArticleCategories = computed(() => ["articles", "article-categories"].includes(resource.value));
const contentLocales = [
  { value: "zh-Hans", label: "简体中文" }, { value: "zh-Hant", label: "繁體中文" },
  { value: "en", label: "English" }, { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" }, { value: "es", label: "Español" },
  { value: "ja", label: "日本語" }, { value: "ko", label: "한국어" },
];
const selectableArticleCategories = computed(() => {
  const forbidden = new Set<string>();
  if (resource.value === "article-categories" && form.value.id) {
    forbidden.add(String(form.value.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of articleCategoryOptions.value) {
        if (item.parentId && forbidden.has(String(item.parentId)) && !forbidden.has(String(item.id))) {
          forbidden.add(String(item.id));
          changed = true;
        }
      }
    }
  }
  return articleCategoryOptions.value.filter((item) => !forbidden.has(String(item.id)) && item.locale === form.value.locale);
});
const title = computed(() => titles[resource.value] || resource.value);
const commerceResources = ["commerce-products", "commerce-categories", "commerce-banners", "commerce-business-configs", "commerce-orders", "commerce-after-sales", "commerce-reviews", "commerce-coupons", "commerce-employees", "commerce-commissions", "commerce-jobs", "payments"];
const isCommerceResource = computed(() => commerceResources.includes(resource.value));
const canWrite = computed(() => canAdminResource(getAdminRoles(), resource.value, "write"));
const canReadRawHealth = computed(() => getAdminRoles().some((role) => ["SUPER_ADMIN", "HEALTH_AUDITOR"].includes(role)));
const canManageMemberVerification = computed(() => getAdminRoles().includes("SUPER_ADMIN"));
const canEditHealthReport = computed(() => getAdminRoles().includes("SUPER_ADMIN"));
const editable = computed(() => (resource.value === "members" ? canManageMemberVerification.value : ["articles", "article-categories", "legal-documents", "settings", "integrations", "admin-users", "commerce-products", "commerce-categories", "commerce-orders", "commerce-after-sales", "commerce-banners", "commerce-business-configs", "commerce-reviews", "commerce-coupons", "health-report-offers", "notification-campaigns"].includes(resource.value) && canAdminResource(getAdminRoles(), resource.value, "write")));
const createable = computed(() => ["articles", "article-categories", "legal-documents", "admin-users", "commerce-categories", "commerce-banners", "commerce-business-configs", "commerce-coupons", "health-report-offers", "notification-campaigns", "commerce-products"].includes(resource.value) && canAdminResource(getAdminRoles(), resource.value, "write"));
const searchable = computed(() => ["members", "commerce-products", "commerce-orders"].includes(resource.value));
const paginatedResources = ["members", "commerce-products", "commerce-orders", "payments"];
const serverStatusResources = ["commerce-products", "commerce-orders", "commerce-after-sales", "commerce-jobs", "payments"];
const columns = computed(() => {
  if (resource.value === "members") return memberColumns;
  if (resource.value === "health-reports") return ["memberNo", "memberNickname", "reportType", "status", "distinctDays", "validRecordCount", "generatedAt", "createdAt"];
  if (resource.value === "feedback") return ["memberNo", "memberNickname", "category", "content", "status", "replyContent", "createdAt"];
  if (resource.value === "articles") return ["product", "title", "locale", "categoryId", "status", "publishedAt", "updatedAt"];
  if (resource.value === "article-categories") return ["categoryNo", "name", "locale", "sort", "enabled"];
  if (resource.value === "legal-documents") return ["legalProduct", "documentType", "locale", "version", "reviewed", "active", "publishedAt"];
  if (resource.value === "settings") return ["appScope", "name", "configuration", "public", "updatedAt"];
  if (resource.value === "devices") return ["memberNo", "memberNickname", "bluetoothName", "model", "deviceIdentifier", "macAddress", "firmware", "lastSeenAt", "status"];
  const first = rows.value[0];
  return first
    ? Object.keys(first)
        .filter((key) => !["passwordHash", "secretRef", "contentHtml", "valueSnapshot", "ruleSnapshot"].includes(key))
        .slice(0, 10)
    : [];
});

function rowProducts(row: Row): string[] {
  if (resource.value === "articles") return [String(row.product ?? "shared")];
  if (resource.value === "legal-documents") return [legalProductForDocumentType(String(row.documentType ?? ""))];
  if (resource.value === "settings") return Array.isArray(row._products) ? row._products : settingProducts(row.key);
  return [];
}

const visibleRows = computed(() => appProductFilter.value ? rows.value.filter((row) => rowProducts(row).includes(appProductFilter.value)) : rows.value);

let loadRequestId = 0;
let healthRequestId = 0;
let editorRequestId = 0;

async function load(): Promise<void> {
  const requestedResource = resource.value;
  if (requestedResource === "commerce") return;
  const requestId = ++loadRequestId;
  loading.value = true;
  loadError.value = "";
  try {
    const params: Row = {
      ...(requestedResource === "health-reports" && reportType.value ? { reportType: reportType.value } : {}),
      ...(searchable.value && search.value ? { search: search.value } : {}),
      ...(paginatedResources.includes(requestedResource) ? { page: currentPage.value } : {}),
      ...(requestedResource === "members" ? { pageSize: memberPageSize } : {}),
      ...(serverStatusResources.includes(requestedResource) && commerceStatus.value ? { status: commerceStatus.value } : {}),
    };
    const response = await api.get(`/${requestedResource}`, {
      params,
    });
    const data = responseData<unknown>(response);
    const dataObject = !Array.isArray(data) && data && typeof data === "object" ? (data as Row) : {};
    if (requestedResource === "members" && (!Array.isArray(dataObject.items) || !Number.isSafeInteger(dataObject.total) || dataObject.total < 0)) {
      throw new Error("会员列表响应不完整，请刷新重试");
    }
    const loadedRows = Array.isArray(data) ? (data as Row[]) : (dataObject.items ?? []);
    const finalRows = requestedResource === "settings" ? await withDownloadSetting(loadedRows) : loadedRows;
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
    { key: "global_support", name: "客服设置" },
    { key: "app_update", name: "赛电 App 更新" },
    { key: "global_app_update", name: "SAYDIAN Health 更新" },
    { key: "say_ring_app_update", name: "Say Ring App 更新" },
    { key: "say_ring_app_display", name: "Say Ring 显示设置" },
    { key: "say_ring_map", name: "Say Ring 运动地图" },
  ];
  return definitions.map((definition) => {
    const row = loadedRows.find((item) => item.key === definition.key);
    const supportEditor = isGlobalSupportSetting(definition.key) && row ? supportEditorFromValue(row.value) : null;
    return row
      ? {
          ...row,
          name: definition.name,
          _products: settingProducts(definition.key),
          appScope: settingProducts(definition.key).map(contentProductLabel).join(" / "),
          configuration: isAppDisplaySetting(definition.key) ? (row.value?.hideAi === true ? "AI已隐藏" : "AI已显示") : isGlobalSupportSetting(definition.key) ? (supportEditor?.enabled && (supportEditor.phone || supportEditor.officialAccount) ? (row.public ? "客服已启用" : "客服未公开") : "客服未启用") : row.value?.configured === false ? "未配置" : row.public ? "已公开" : "未公开",
        }
      : {
          ...definition,
          _products: settingProducts(definition.key),
          appScope: settingProducts(definition.key).map(contentProductLabel).join(" / "),
          configuration: isAppDisplaySetting(definition.key) ? "AI已显示（默认）" : "未配置",
          public: false,
          updatedAt: null,
          _unconfigured: true,
          ...(definition.key === "global_support" ? { value: { configured: false } } : {}),
          ...(isAppDisplaySetting(definition.key) ? { value: { hideAi: false } } : {}),
          ...(definition.key === "say_ring_map" ? { value: { provider: "amap", enabled: false, configured: false } } : {}),
        };
  });
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function deviceCapabilities(value: unknown): string[] {
  return Array.isArray(value) ? value.map((capability) => String(capability ?? "").trim()).filter(Boolean) : [];
}

function deviceCapabilityLabel(value: string): string {
  const labels: Record<string, string> = {
    "metric:heart_rate": "心率",
    "metric:blood_oxygen": "血氧",
    "metric:blood_pressure": "血压",
    "metric:sleep": "睡眠",
    "metric:steps": "步数",
    "metric:calories": "卡路里",
    "metric:distance": "距离",
    "metric:temperature": "体温",
    "metric:ecg": "心电",
    "feature:watch_faces": "表盘中心",
    "feature:photo_watch_face": "照片表盘",
    "feature:find_watch": "查找设备",
    "feature:camera": "相机遥控",
    "feature:phone_calls": "电话",
    "feature:notifications": "消息通知",
    "feature:alarms": "闹钟",
    "support:sport_pause": "运动暂停",
    "support:background_sync": "后台同步",
    "support:ota": "固件升级",
  };
  return labels[value] || value;
}

function pointMoney(value: unknown): string {
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? `¥${(cents / 100).toFixed(2)}` : "未开通";
}

function localDateTime(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

let deviceDetailRequestId = 0;
let deviceMeasurementsRequestId = 0;
let memberDevicesRequestId = 0;

async function openMemberDevices(row: Row): Promise<void> {
  const requestId = ++memberDevicesRequestId;
  memberDevicesVisible.value = true;
  memberDevicesLoading.value = true;
  memberDeviceMember.value = { memberNo: row.memberNo, memberNickname: row.nickname };
  memberDevices.value = [];
  try {
    const data = responseData<Row>(await api.get(`/members/${encodeURIComponent(String(row.id))}/devices`));
    if (requestId !== memberDevicesRequestId || !memberDevicesVisible.value) return;
    memberDeviceMember.value = data.member ?? memberDeviceMember.value;
    memberDevices.value = Array.isArray(data.devices) ? data.devices : [];
  } catch (error) {
    if (requestId === memberDevicesRequestId) ElMessage.error(readableError(error));
  } finally {
    if (requestId === memberDevicesRequestId) memberDevicesLoading.value = false;
  }
}

async function openDeviceDetails(row: Row): Promise<void> {
  const requestId = ++deviceDetailRequestId;
  deviceDetailVisible.value = true;
  deviceDetailLoading.value = true;
  deviceDetail.value = { ...row };
  deviceConnections.value = [];
  deviceHistoryTab.value = "connections";
  deviceMeasurements.value = [];
  deviceMeasurementsLoading.value = false;
  deviceMeasurementsLoaded.value = false;
  deviceMeasurementPage.value = 1;
  deviceMeasurementTotal.value = 0;
  deviceMeasurementReason.value = "";
  deviceMeasurementsMessage.value = canReadRawHealth.value ? "" : "当前账号无权查看健康测量记录";
  try {
    const data = responseData<Row>(await api.get(`/devices/${encodeURIComponent(String(row.id))}/connections`));
    if (requestId !== deviceDetailRequestId || !deviceDetailVisible.value) return;
    deviceDetail.value = data.device ?? row;
    deviceConnections.value = Array.isArray(data.connections) ? data.connections : [];
  } catch (error) {
    if (requestId === deviceDetailRequestId) ElMessage.error(readableError(error));
  } finally {
    if (requestId === deviceDetailRequestId) deviceDetailLoading.value = false;
  }
}

async function changeDeviceHistoryTab(name: string | number): Promise<void> {
  if (name !== "measurements" || !deviceDetailVisible.value || !canReadRawHealth.value
    || deviceMeasurementsLoaded.value || deviceMeasurementsLoading.value || deviceDetailLoading.value) return;
  const requestId = deviceDetailRequestId;
  deviceMeasurementsLoading.value = true;
  try {
    if (!getAdminRoles().includes("SUPER_ADMIN") && !deviceMeasurementReason.value) {
      const response = await ElMessageBox.prompt("设备测量记录属于敏感健康信息。请填写本次查看的具体业务原因，系统将记录操作者、原因和时间。", "敏感数据访问确认", {
        type: "warning",
        confirmButtonText: "确认查看",
        cancelButtonText: "取消",
        inputPlaceholder: "例如：处理会员反馈单 #12345",
        inputValidator: (value) => value.trim().length >= 5 || "请填写至少5个字的具体原因",
      });
      if (requestId !== deviceDetailRequestId || !deviceDetailVisible.value) return;
      deviceMeasurementReason.value = response.value.trim();
    }
    if (requestId !== deviceDetailRequestId || !deviceDetailVisible.value || deviceHistoryTab.value !== "measurements") return;
    await loadDeviceMeasurements(deviceMeasurementPage.value);
  } catch {
    if (requestId === deviceDetailRequestId) deviceMeasurementsMessage.value = "已取消查看测量记录";
  } finally {
    if (requestId === deviceDetailRequestId) deviceMeasurementsLoading.value = false;
  }
}

async function loadDeviceMeasurements(page: number): Promise<void> {
  if (!canReadRawHealth.value || !deviceDetailVisible.value) return;
  const detailRequestId = deviceDetailRequestId;
  const requestId = ++deviceMeasurementsRequestId;
  const deviceId = String(deviceDetail.value.id ?? "");
  deviceMeasurementPage.value = page;
  deviceMeasurementsLoading.value = true;
  try {
    const data = responseData<Row>(await api.get(`/devices/${encodeURIComponent(deviceId)}/measurements`, {
      params: {
        page,
        pageSize: 50,
        ...(deviceMeasurementReason.value ? { reason: deviceMeasurementReason.value } : {}),
      },
    }));
    if (requestId !== deviceMeasurementsRequestId || detailRequestId !== deviceDetailRequestId || !deviceDetailVisible.value) return;
    deviceMeasurements.value = Array.isArray(data.records) ? data.records : [];
    deviceMeasurementTotal.value = Number(data.total) || 0;
    deviceMeasurementsMessage.value = "";
    deviceMeasurementsLoaded.value = true;
  } catch (error) {
    if (requestId === deviceMeasurementsRequestId && detailRequestId === deviceDetailRequestId) {
      deviceMeasurementsLoaded.value = false;
      deviceMeasurementsMessage.value = readableError(error);
    }
  } finally {
    if (requestId === deviceMeasurementsRequestId && detailRequestId === deviceDetailRequestId) deviceMeasurementsLoading.value = false;
  }
}

function changeDeviceMeasurementPage(page: number): void {
  void loadDeviceMeasurements(page);
}

function closeDeviceDetails(): void {
  deviceDetailRequestId += 1;
  deviceMeasurementsRequestId += 1;
  deviceMeasurementReason.value = "";
  deviceMeasurementsLoading.value = false;
}

function adjustmentKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pointDeltaCents(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^-?(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(text)) throw new Error("积分调整金额最多保留两位小数");
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents === 0) throw new Error("积分调整金额不能为0");
  return cents;
}

function contactVerificationLabel(row: Row, channel: "mobile" | "email"): string {
  const status = String(row[`${channel}VerificationStatus`] ?? "");
  if (status === "VERIFIED") return "已验证";
  if (status === "UNVERIFIED") return "未验证";
  return "未填写";
}

function comparableMemberContact(channel: "mobile" | "email", value: unknown): string {
  const text = String(value ?? "").trim();
  return channel === "email" ? text.toLowerCase() : text.replace(/[\s()\-]/g, "");
}

function onMemberContactInput(channel: "mobile" | "email", value: unknown): void {
  const verifiedField = `${channel}Verified`;
  const originalField = channel === "mobile" ? "_originalMobile" : "_originalEmail";
  const originalVerifiedField = channel === "mobile" ? "_originalMobileVerified" : "_originalEmailVerified";
  form.value[channel] = String(value ?? "");
  form.value[verifiedField] = comparableMemberContact(channel, value) === comparableMemberContact(channel, form.value[originalField]) ? Boolean(form.value[originalVerifiedField]) : false;
}

function memberBirthdayDisabled(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() > today.getTime();
}

async function openCreate(): Promise<void> {
  const requestedResource = resource.value;
  const requestId = ++editorRequestId;
  if (needsArticleCategories.value && !(await loadArticleCategories(requestedResource, requestId))) return;
  if (["commerce-products", "commerce-categories"].includes(resource.value)) await ensureCommerceCategories();
  if (requestId !== editorRequestId || requestedResource !== resource.value) return;
  originalArticleCategoryId.value = null;
  erpLookupError.value = "";
  dialogMode.value = "edit";
  dialogTitle.value = `新增${title.value}`;
  const defaults: Record<string, Row> = {
    articles: { status: "DRAFT", categoryId: null, locale: "zh-Hans", product: "shared" },
    "article-categories": { enabled: true, sort: 0, parentId: null, locale: "zh-Hans" },
    "legal-documents": createLegalDocumentDraft("saydian-global"),
    "admin-users": { role: "READ_ONLY", roles: ["READ_ONLY"], active: true },
    "commerce-products": {
      source: "ERP",
      _erpLookupSku: "",
      _erpLookupPending: true,
      status: "DRAFT",
      gallery: [],
      tags: [],
      featured: false,
      sort: 0,
      skus: [],
    },
    "commerce-categories": { _isNew: true, enabled: true, sort: 0 },
    "commerce-banners": { enabled: true, sort: 0 },
    "commerce-business-configs": {
      _isNew: true,
      key: "",
      label: "",
      enabled: false,
      valueText: "{}",
    },
    "commerce-coupons": {
      status: "DRAFT",
      value: 100,
      minimumSpendCents: 0,
      totalQuantity: 100,
      redemptionCode: "",
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      employeeDistributable: false,
      perEmployeeLimit: 0,
    },
    "health-report-offers": {
      entitlement: "SINGLE_REPORT",
      creditCount: 1,
      platforms: ["android", "h5"],
      active: false,
    },
    "notification-campaigns": {
      type: "SYSTEM",
      audienceAllActive: false,
      audienceUserIds: "",
    },
  };
  form.value = defaults[resource.value] ?? {};
  dialogVisible.value = true;
}

async function openEdit(row: Row): Promise<void> {
  const requestedResource = resource.value;
  const requestId = ++editorRequestId;
  if (requestedResource === "members") {
    if (!canManageMemberVerification.value) return;
    dialogVisible.value = false;
    try {
      const [profileResponse, employeesResponse] = await Promise.all([api.get(`/members/${encodeURIComponent(String(row.id))}/profile`), api.get("/commerce-employees")]);
      const profile = responseData<Row>(profileResponse);
      const employeesData = responseData<unknown>(employeesResponse);
      const employees = Array.isArray(employeesData) ? employeesData : Array.isArray((employeesData as Row | null)?.items) ? (employeesData as Row).items : [];
      if (requestId !== editorRequestId || requestedResource !== resource.value) return;
      memberReferralOptions.value = employees.filter((item: Row) => item?.id && (item.active === true || item.id === profile.referralEmployeeId));
      if (profile.referralEmployee?.id && !memberReferralOptions.value.some((item) => item.id === profile.referralEmployee.id)) {
        memberReferralOptions.value.unshift(profile.referralEmployee);
      }
      dialogMode.value = "edit";
      dialogTitle.value = `编辑会员 ${profile.memberNo ?? row.memberNo ?? ""}`.trim();
      form.value = {
        ...profile,
        avatarUrl: profile.avatarUrl ?? "",
        gender: profile.gender ?? "UNSPECIFIED",
        birthday: profile.birthday ?? "",
        heightCm: profile.heightCm ?? null,
        weightKg: profile.weightKg ?? null,
        mobile: profile.mobile ?? "",
        email: profile.email ?? "",
        _originalMobile: profile.mobile ?? "",
        _originalEmail: profile.email ?? "",
        _originalMobileVerified: profile.mobileVerified === true,
        _originalEmailVerified: profile.emailVerified === true,
        referralEmployeeId: profile.referralEmployeeId ?? null,
        _originalReferralEmployeeId: profile.referralEmployeeId ?? null,
        pointBalanceCents: profile.pointBalanceCents,
        pointAdjustment: "",
        pointAdjustmentReason: "",
        _pointAdjustmentKey: adjustmentKey(),
        newPassword: "",
      };
      dialogVisible.value = true;
    } catch (error) {
      if (requestId === editorRequestId && requestedResource === resource.value) {
        ElMessage.error(`会员资料加载失败：${readableError(error)}`);
      }
    }
    return;
  }
  if (needsArticleCategories.value && !(await loadArticleCategories(requestedResource, requestId))) return;
  if (["commerce-products", "commerce-categories"].includes(resource.value)) await ensureCommerceCategories();
  if (requestId !== editorRequestId || requestedResource !== resource.value) return;
  originalArticleCategoryId.value = String(row[requestedResource === "articles" ? "categoryId" : "parentId"] ?? "") || null;
  dialogMode.value = "edit";
  dialogTitle.value = `编辑${title.value}`;
  const nextForm: Row = {
    ...row,
    roles: Array.isArray(row.roles) && row.roles.length ? [...row.roles] : [row.role ?? "READ_ONLY"],
    skus: Array.isArray(row.skus) ? row.skus.map((sku: Row) => ({ ...sku, _originalImage: String(sku.image ?? "") })) : [],
    _isNew: false,
    publicConfigText: row.publicConfig ? JSON.stringify(row.publicConfig, null, 2) : "{}",
    secretsText: "",
    mapWebServiceKey: "",
    clearSecrets: false,
    valueText: row.value ? JSON.stringify(row.value, null, 2) : "{}",
    galleryText: Array.isArray(row.gallery) ? row.gallery.join("\n") : "",
    tagsText: Array.isArray(row.tags) ? row.tags.join("，") : "",
    platforms: Array.isArray(row.platforms) ? row.platforms : [],
    audienceAllActive: row.audience?.allActive === true,
    audienceUserIds: Array.isArray(row.audience?.userIds) ? row.audience.userIds.join("\n") : "",
  };
  if (requestedResource === "legal-documents") Object.assign(nextForm, legalDocumentEditorFromRow(row));
  if (isAppDisplaySetting(row.key)) { nextForm.hideAi = row.value?.hideAi === true; nextForm.sleepAiEnabled = row.value?.sleepAiEnabled === true; }
  if (isGlobalSupportSetting(row.key)) nextForm.supportEditor = supportEditorFromValue(row.value);
  if (isAppUpdateSetting(row.key)) {
    try {
      nextForm.downloadEditor = row._unconfigured ? createDownloadDraft(row.key) : downloadManifestToEditor(row.key, row.value);
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "App 下载配置无法读取");
      return;
    }
  }
  form.value = nextForm;
  dialogVisible.value = true;
}

function changeLegalDocumentProduct(product: "saydian-global" | "say-ring"): void {
  form.value = selectLegalDocumentProduct(form.value as any, product);
}

function changeLegalDocumentType(documentType: string): void {
  form.value = selectLegalDocumentType(form.value as any, documentType);
}

async function loadArticleCategories(requestedResource: string, requestId: number): Promise<boolean> {
  articleCategoriesReady.value = false;
  articleCategoryEditorResource.value = "";
  articleCategoryOptions.value = [];
  dialogVisible.value = false;
  healthReportVisible.value = false;
  healthReportRow.value = null;
  feedbackVisible.value = false;
  feedbackForm.value = {};
  form.value = {};
  const isCurrent = () => requestId === editorRequestId && requestedResource === resource.value;
  try {
    const data = responseData<unknown>(await api.get("/article-categories"));
    if (!Array.isArray(data) || data.some((item) => !item || typeof item.id !== "string" || typeof item.name !== "string")) {
      throw new Error("分类数据不完整");
    }
    if (!isCurrent()) return false;
    articleCategoryOptions.value = data;
    articleCategoriesReady.value = true;
    articleCategoryEditorResource.value = requestedResource;
    return true;
  } catch (error) {
    if (isCurrent()) ElMessage.error(`分类加载失败，请重试后再编辑：${error instanceof Error && error.message === "分类数据不完整" ? error.message : readableError(error)}`);
    return false;
  }
}

function articleCategoryLabel(item: Row): string {
  return `${item.name}（编号 ${item.categoryNo ?? "未获取"}）${item.enabled === false ? " · 已停用" : ""}`;
}

function changeContentLocale(locale: string): void {
  form.value.locale = locale;
  const relation = resource.value === "articles" ? "categoryId" : "parentId";
  if (!selectableArticleCategories.value.some((item) => item.id === form.value[relation])) form.value[relation] = null;
}

function articleCategorySelectionValid(): boolean {
  const selectedId = form.value[resource.value === "articles" ? "categoryId" : "parentId"];
  if (!selectedId) return true;
  const selected = selectableArticleCategories.value.find((item) => item.id === selectedId);
  if (selected) return selected.enabled !== false || selectedId === originalArticleCategoryId.value;
  return selectedId === originalArticleCategoryId.value && !articleCategoryOptions.value.some((item) => item.id === selectedId);
}

function validateCouponPeriod(source: Row): void {
  const validFrom = new Date(String(source.validFrom ?? ""));
  const validUntil = new Date(String(source.validUntil ?? ""));
  if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validUntil.getTime())) {
    throw new Error("请选择优惠券的生效时间和失效时间");
  }
  if (validUntil.getTime() <= validFrom.getTime()) throw new Error("失效时间必须晚于生效时间");
}

async function ensureCommerceCategories(): Promise<void> {
  if (categoryOptions.value.length) return;
  try {
    const data = responseData<unknown>(await api.get("/commerce-categories"));
    categoryOptions.value = Array.isArray(data) ? (data as Row[]) : [];
  } catch (error) {
    ElMessage.error(readableError(error));
  }
}

async function loadCommerceProductBySku(): Promise<void> {
  if (erpLookupBusy.value) return;
  const sku = String(form.value._erpLookupSku ?? "").trim();
  if (!sku) {
    erpLookupError.value = "请填写 ERP SKU";
    ElMessage.error(erpLookupError.value);
    return;
  }
  erpLookupError.value = "";
  erpLookupBusy.value = true;
  try {
    const product = responseData<Row>(await api.post("/commerce-products/erp-import", { sku }));
    form.value = {
      ...product,
      source: "ERP",
      _erpLookupSku: sku,
      _erpLookupPending: false,
      _erpSnapshotText: product.erpLookup ? JSON.stringify(product.erpLookup, null, 2) : "",
      skus: product.skus.map((entry: Row) => ({ ...entry, _originalImage: String(entry.image ?? "") })),
      galleryText: Array.isArray(product.gallery) ? product.gallery.join("\n") : "",
      tagsText: Array.isArray(product.tags) ? product.tags.join("，") : "",
    };
    dialogTitle.value = `编辑商品 · ERP 实时资料已载入`;
    ElMessage.success("已从 ERP 实时获取并导入商品资料");
  } catch (error) {
    form.value._erpLookupPending = true;
    const message = readableError(error);
    erpLookupError.value = message.includes("聚水潭未找到 SKU") ? `${message}。请在聚水潭确认完整 SKU 编码后重试。` : message;
    ElMessage.error(erpLookupError.value);
  } finally {
    erpLookupBusy.value = false;
  }
}

async function deleteCommerceProduct(row: Row): Promise<void> {
  const id = String(row.id ?? "").trim();
  if (!id) {
    ElMessage.error("商品编号无效，请刷新后重试");
    return;
  }
  const name = String(row.displayName || row.name || row.erpItemId || "该商品");
  try {
    await ElMessageBox.confirm(`确认永久删除“${name}”？删除后无法恢复；已有订单或评价的商品将被系统拦截，请改用归档。`, "删除商品", {
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/commerce-products/${encodeURIComponent(id)}`);
    ElMessage.success("商品已删除");
    await load();
  } catch (error) {
    ElMessage.error(readableError(error));
  }
}

async function save(): Promise<void> {
  if (saving.value) return;
  if (needsArticleCategories.value && (!articleCategoriesReady.value || articleCategoryEditorResource.value !== resource.value)) {
    ElMessage.error("请重新打开编辑窗口，等待分类加载成功后保存");
    return;
  }
  if (needsArticleCategories.value && !articleCategorySelectionValid()) {
    ElMessage.error("请选择同语言的可用分类；上级分类不能是自身或下级分类");
    return;
  }
  if (resource.value === "commerce-products" && form.value._erpLookupPending) {
    ElMessage.error("请先填写 SKU 并获取 ERP 商品资料");
    return;
  }
  saving.value = true;
  try {
    const id = String(form.value.id ?? "");
    if (resource.value === "commerce-coupons") validateCouponPeriod(form.value);
    let payload: Row = payloadForResource(resource.value, form.value);
    if (resource.value === "admin-users") {
      payload.username = String(form.value.username ?? "").trim();
      payload.displayName = String(form.value.displayName ?? "").trim();
      if (!id && !/^[a-zA-Z0-9_.-]{3,50}$/.test(payload.username)) throw new Error("账号需为3至50位字母、数字、下划线、点或短横线");
      if (!payload.displayName || payload.displayName.length > 50) throw new Error("显示名称需为1至50个字");
      if (!Array.isArray(payload.roles) || !payload.roles.length) throw new Error("至少选择一个后台角色");
      if (!id && String(payload.password ?? "").length < 12) throw new Error("初始密码至少需要12位");
    }
    if (resource.value === "legal-documents" && form.value.active === true) {
      await ElMessageBox.confirm(
        `确认启用 ${form.value.legalProduct === "say-ring" ? "Say Ring" : "Saydian Health"} 的「${legalDocumentTypeLabel(form.value.documentType)}」${form.value.version ? `（${form.value.version}）` : ""}？只有此 App 会读取该文档。`,
        "确认发布法律文档",
        { type: "warning", confirmButtonText: "确认启用", cancelButtonText: "取消" },
      );
    }
    if (resource.value === "members") {
      if (!canManageMemberVerification.value || !id) throw new Error("当前账号无权编辑会员资料");
      const manuallyConfirmed: string[] = [];
      if (form.value.mobileVerified === true && (form.value._originalMobileVerified !== true || comparableMemberContact("mobile", form.value.mobile) !== comparableMemberContact("mobile", form.value._originalMobile))) manuallyConfirmed.push("手机号");
      if (form.value.emailVerified === true && (form.value._originalEmailVerified !== true || comparableMemberContact("email", form.value.email) !== comparableMemberContact("email", form.value._originalEmail))) manuallyConfirmed.push("邮箱");
      if (manuallyConfirmed.length) {
        await ElMessageBox.confirm(`确认已通过人工方式核实该会员的${manuallyConfirmed.join("和")}？保存后将作为正式验证状态使用。`, "确认联系方式已核实", {
          type: "warning",
          confirmButtonText: "确认已核实",
          cancelButtonText: "取消",
        });
      }
      const newPassword = String(form.value.newPassword ?? "");
      const deltaCents = pointDeltaCents(form.value.pointAdjustment);
      const pointReason = String(form.value.pointAdjustmentReason ?? "").trim();
      if (deltaCents && (pointReason.length < 2 || pointReason.length > 200)) throw new Error("调整积分时请填写2至200字原因");
      if (deltaCents) {
        await ElMessageBox.confirm(`确认将该会员积分${deltaCents > 0 ? "增加" : "扣减"} ${(Math.abs(deltaCents) / 100).toFixed(2)} 元？此操作会写入积分流水和审计日志。`, "确认调整积分", {
          type: "warning",
          confirmButtonText: "确认调整",
          cancelButtonText: "取消",
        });
      }
      if (newPassword) {
        if (newPassword.length < 8) throw new Error("新密码至少需要8位");
        await ElMessageBox.confirm("确认修改该会员的登录密码？保存后该会员所有已登录设备都会退出，需要使用新密码重新登录。", "确认修改密码", {
          type: "warning",
          confirmButtonText: "确认修改",
          cancelButtonText: "取消",
        });
      }
      payload = {
        nickname: form.value.nickname,
        avatarUrl: form.value.avatarUrl,
        gender: form.value.gender,
        birthday: form.value.birthday,
        heightCm: form.value.heightCm,
        weightKg: form.value.weightKg,
        mobile: form.value.mobile,
        email: form.value.email,
        status: form.value.status,
        mobileVerified: form.value.mobileVerified === true,
        emailVerified: form.value.emailVerified === true,
        referralEmployeeId: form.value.referralEmployeeId || null,
        ...(newPassword ? { newPassword } : {}),
        expectedUpdatedAt: form.value.verificationVersion,
      };
      await api.patch(`/members/${encodeURIComponent(id)}/profile`, payload);
      if (deltaCents) {
        const adjusted = responseData<Row>(
          await api.post(`/members/${encodeURIComponent(id)}/points-adjustments`, {
            deltaCents,
            reason: pointReason,
            idempotencyKey: form.value._pointAdjustmentKey,
          }),
        );
        form.value.pointBalanceCents = adjusted.balanceCents;
      }
    } else if (resource.value === "integrations") {
      const secretsText = String(form.value.secretsText || "").trim();
      payload = {
        state: form.value.state,
        publicConfig: JSON.parse(String(form.value.publicConfigText || "{}")),
        ...(secretsText ? { secrets: JSON.parse(secretsText) } : {}),
        ...(form.value.clearSecrets === true ? { clearSecrets: true } : {}),
      };
      await api.patch(`/integrations/${encodeURIComponent(String(form.value.key))}`, payload);
    } else if (resource.value === "settings") {
      const mapSetting = form.value.key === "say_ring_map";
      const globalSupportSetting = isGlobalSupportSetting(form.value.key);
      const settingValue = globalSupportSetting
        ? supportEditorToValue(form.value.supportEditor ?? {})
        : mapSetting
          ? {
              provider: "amap",
              enabled: form.value.value?.enabled === true,
              configured: form.value.value?.configured === true,
            }
          : isAppDisplaySetting(form.value.key)
            ? { hideAi: form.value.hideAi === true, sleepAiEnabled: form.value.sleepAiEnabled === true }
            : isAppUpdateSetting(form.value.key)
              ? downloadEditorToManifest(form.value.key, form.value.downloadEditor as DownloadManifestEditor)
              : JSON.parse(String(form.value.valueText || "{}"));
      payload = {
        value: settingValue,
        public: isAppDisplaySetting(form.value.key) ? true : mapSetting ? form.value.public === true : form.value.public !== false,
      };
      if (mapSetting && String(form.value.mapWebServiceKey ?? "").trim()) {
        payload.webServiceKey = String(form.value.mapWebServiceKey).trim();
      }
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
    ElMessage.success(resource.value === "members" ? (form.value.pointAdjustment ? "会员资料与积分已保存" : form.value.newPassword ? "会员资料和密码已保存，原登录已退出" : "会员资料已保存") : "已保存");
    dialogVisible.value = false;
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    const message = readableError(error);
    ElMessage.error(message === "请求失败，请稍后重试" && error instanceof Error ? error.message : message);
  } finally {
    saving.value = false;
  }
}

function setDownloadPublishedNow(): void {
  const editor = form.value.downloadEditor as DownloadManifestEditor | undefined;
  if (editor) editor.publishedAt = new Date().toISOString();
}

function appendProductGalleryImage(url: string): void {
  const value = String(url ?? "").trim();
  if (!value) return;
  const gallery = String(form.value.galleryText ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!gallery.includes(value)) gallery.push(value);
  form.value.galleryText = gallery.join("\n");
}

function fillDownloadUrl(platform: "android" | "ios" | "harmonyos"): void {
  if (platform === "ios") return;
  const editor = form.value.downloadEditor as DownloadManifestEditor | undefined;
  const release = editor?.releases[platform];
  if (release?.fileName) release.url = `${form.value.key === "app_update" ? "" : "/global"}/down/files/${release.fileName.trim()}`;
}

async function uploadAppPackage(platform: "android" | "ios" | "harmonyos", event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  if (platform === "ios") return;
  const file = input.files?.[0];
  if (!file) return;
  const expectedExtension = platform === "android" ? ".apk" : ".hap";
  if (!file.name.toLowerCase().endsWith(expectedExtension)) {
    ElMessage.error(`请选择 ${expectedExtension.toUpperCase()} 安装包`);
    input.value = "";
    return;
  }
  packageUploading.value = { ...packageUploading.value, [platform]: true };
  try {
    const body = new FormData();
    body.append("file", file);
    const uploaded = responseData<Row>(await api.post(`/app-packages?platform=${encodeURIComponent(platform)}`, body, { timeout: 5 * 60_000 }));
    const editor = form.value.downloadEditor as DownloadManifestEditor;
    const release = editor.releases[platform];
    release.destinationKind = "direct";
    release.fileName = String(uploaded.fileName ?? "");
    release.url = String(uploaded.url ?? "");
    release.sizeBytes = Number(uploaded.sizeBytes ?? 0);
    release.sha256 = String(uploaded.sha256 ?? "");
    ElMessage.success("安装包上传成功，保存设置后正式发布");
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    packageUploading.value = { ...packageUploading.value, [platform]: false };
    input.value = "";
  }
}

function payloadForResource(current: string, source: Row): Row {
  if (current === "legal-documents") return legalDocumentPayload(source as any);
  const fields: Record<string, string[]> = {
    "admin-users": ["username", "displayName", "password", "roles", "active"],
    articles: ["product", "title", "summary", "categoryId", "coverUrl", "contentHtml", "status", "locale", "publishedAt"],
    "article-categories": ["name", "parentId", "locale", "sort", "enabled"],
    "commerce-products": ["displayName", "subtitle", "brand", "categoryId", "coverImage", "detailHtml", "status", "featured", "sort", "localArchived"],
    "commerce-categories": ["name", "parentId", "iconUrl", "sort", "enabled"],
    "commerce-banners": ["title", "imageUrl", "targetUrl", "sort", "enabled"],
    "commerce-reviews": ["published"],
    "commerce-orders": ["adminRemark", "version"],
    "commerce-after-sales": ["status", "returnLogisticsCompany", "returnTrackingNo", "version"],
    "commerce-coupons": ["name", "redemptionCode", "status", "value", "minimumSpendCents", "totalQuantity", "validFrom", "validUntil", "employeeDistributable", "perEmployeeLimit"],
    "health-report-offers": ["offerKey", "title", "description", "entitlement", "priceCents", "currency", "creditCount", "durationDays", "platforms", "appleProductId", "active", "effectiveFrom", "effectiveUntil"],
    "notification-campaigns": ["name", "type", "title", "body", "deepLink", "scheduledAt"],
  };
  if (current === "articles" || current === "article-categories") {
    const relation = current === "articles" ? "categoryId" : "parentId";
    return {
      ...pick(source, fields[current]!),
      [relation]: source[relation] || null,
    };
  }
  if (current === "commerce-products") {
    const skuImages = source.source === "ERP" && Array.isArray(source.skus)
      ? source.skus
          .filter((sku: Row) => String(sku.image ?? "").trim() !== String(sku._originalImage ?? "").trim())
          .map((sku: Row) => ({ id: sku.id, updatedAt: sku.updatedAt, image: String(sku.image ?? "").trim() || null }))
      : [];
    return {
      ...pick(source, fields["commerce-products"]!),
      ...(source.source === "LOCAL"
        ? {
            name: source.name,
            ...(source.erpItemId ? { erpItemId: source.erpItemId } : {}),
            source: "LOCAL",
            skus: source.skus,
          }
        : {}),
      ...(skuImages.length ? { skuImages } : {}),
      gallery: String(source.galleryText ?? "")
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      tags: String(source.tagsText ?? "")
        .split(/[,，\r\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }
  if (current === "notification-campaigns") {
    return {
      ...pick(source, fields["notification-campaigns"]!),
      audience:
        source.audienceAllActive === true
          ? { allActive: true }
          : {
              userIds: String(source.audienceUserIds ?? "")
                .split(/[，,\r\n]/)
                .map((value) => value.trim())
                .filter(Boolean),
            },
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

function openFeedback(row: Row): void {
  feedbackForm.value = {
    ...row,
    replyContent: String(row.replyContent ?? ""),
    status: String(row.status ?? "OPEN"),
  };
  feedbackVisible.value = true;
}

async function saveFeedback(): Promise<void> {
  if (feedbackSaving.value || !feedbackForm.value.id) return;
  const replyContent = String(feedbackForm.value.replyContent ?? "").trim();
  if (replyContent && replyContent.length < 2) {
    ElMessage.error("回复内容至少需要2个字");
    return;
  }
  feedbackSaving.value = true;
  try {
    await api.patch(`/feedback/${encodeURIComponent(String(feedbackForm.value.id))}`, {
      status: feedbackForm.value.status,
      ...(replyContent ? { replyContent } : {}),
    });
    ElMessage.success(replyContent ? "回复已保存，会员可在 App 通知中心和客服中心查看" : "反馈状态已更新");
    feedbackVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    feedbackSaving.value = false;
  }
}

function openHealthReport(row: Row): void {
  if (!canReadRawHealth.value) return;
  healthReportRow.value = row;
  healthReportVisible.value = true;
}

async function viewHealth(row: Row, raw: boolean): Promise<void> {
  if (resource.value !== "members" || (raw && !canReadRawHealth.value)) return;
  const requestId = ++healthRequestId;
  const isCurrentRequest = () => requestId === healthRequestId && resource.value === "members";
  detailRows.value = [];
  dialogVisible.value = false;
  let reason: string | undefined;
  if (raw && !getAdminRoles().includes("SUPER_ADMIN")) {
    try {
      const response = await ElMessageBox.prompt("原始健康记录属于敏感信息。请填写本次查看的具体业务原因，系统将记录操作者、原因和时间。", "敏感数据访问确认", {
        type: "warning",
        confirmButtonText: "确认查看",
        cancelButtonText: "取消",
        inputPlaceholder: "例如：处理会员反馈单 #12345",
        inputValidator: (value) => value.trim().length >= 5 || "请填写至少5个字的具体原因",
      });
      reason = response.value.trim();
    } catch {
      return;
    }
  }
  if (!isCurrentRequest()) return;
  try {
    const suffix = raw ? "health-records" : "health-summary";
    const data = responseData<unknown>(
      await api.get(`/members/${encodeURIComponent(String(row.id))}/${suffix}`, {
        params: reason === undefined ? {} : { reason },
      }),
    );
    if (!isCurrentRequest()) return;
    detailRows.value = Array.isArray(data) ? (data as Row[]) : [];
    healthMode.value = raw ? "raw" : "summary";
    healthMember.value = { id: String(row.id), memberNo: row.memberNo };
    dialogMode.value = "health";
    dialogTitle.value = `${row.memberNo ?? "会员"} · ${raw ? "原始健康记录（已审计）" : "健康数据摘要"}`;
    dialogVisible.value = true;
  } catch (error) {
    if (isCurrentRequest()) ElMessage.error(readableError(error));
  }
}

async function runAction(path: string, success: string): Promise<void> {
  try {
    await ElMessageBox.confirm("确认执行此操作？", "操作确认", {
      type: "warning",
    });
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
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(readableError(error));
  }
}

async function refundAfterSale(row: Row): Promise<void> {
  try {
    const local = Number(row.requestedCents) === 0;
    const pointText = row.pointReturnCents == null ? "待核验" : (Number(row.pointReturnCents) / 100).toFixed(2);
    const response = await ElMessageBox.prompt(local ? `本单现金退款为0，将本地返还积分 ${pointText}。此操作不向支付渠道发起零元退款。` : `本次现金原路退款 ${Number(row.requestedCents) / 100} 元（含运费 ${row.shippingRefundCents == null ? "待核验" : Number(row.shippingRefundCents) / 100} 元），渠道确认成功后返还积分 ${pointText}。受理不等于成功。`, local ? "结算积分" : row.type === "SHIPPING_ONLY" ? "执行已审核运费退款" : "发起退款", {
      type: "warning",
      inputValue: String(row.reason ?? "售后退款"),
      inputValidator: (value) => value.trim().length >= 2 || "请填写退款原因",
      confirmButtonText: "确认发起",
    });
    await api.post(`/commerce-after-sales/${row.id}/refund`, {
      reason: response.value.trim(),
    });
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
    shipmentForm.value = {
      logisticsCompany: "",
      trackingNo: "",
      quantities: Object.fromEntries((shipmentPreview.value.items ?? []).map((item: Row) => [item.orderItemId, 0])),
    };
    shipmentVisible.value = true;
  } catch (error) {
    ElMessage.error(readableError(error));
  }
}

async function saveShipment(): Promise<void> {
  if (shipmentBusy.value || shipmentPreview.value.unavailableReason) return;
  const items = Object.entries(shipmentForm.value.quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const logisticsCompany = shipmentForm.value.logisticsCompany.trim();
  const trackingNo = shipmentForm.value.trackingNo.trim();
  if (!logisticsCompany || !trackingNo || !items.length) {
    ElMessage.warning("请填写承运公司、运单号，并选择本包裹商品数量");
    return;
  }
  shipmentBusy.value = true;
  try {
    await api.post(`/commerce-orders/${encodeURIComponent(String(shipmentPreview.value.orderId))}/shipments`, {
      version: shipmentPreview.value.version,
      logisticsCompany,
      trackingNo,
      items,
    });
    ElMessage.success("包裹已登记；物流轨迹以承运方实际结果为准");
    shipmentVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    shipmentBusy.value = false;
  }
}

const shippingRequestKeys = new Map<string, { signature: string; key: string }>();
async function requestShippingRefund(row: Row): Promise<void> {
  try {
    const preview = responseData<Row>(await api.get(`/commerce-orders/${encodeURIComponent(String(row.id))}/shipping-refunds/preview`));
    if (Number(preview.maximumCents) <= 0) {
      ElMessage.warning("已无可申请的运费或现金额度");
      return;
    }
    const amount = await ElMessageBox.prompt(`剩余可申请运费 ${(Number(preview.maximumCents) / 100).toFixed(2)} 元。商品退款后不自动退运费，本申请需财务审核。`, "申请单独退运费", {
      inputValue: (Number(preview.maximumCents) / 100).toFixed(2),
      inputPattern: /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/,
      inputErrorMessage: "请填写最多两位小数的正金额",
    });
    const [whole, fraction = ""] = amount.value.trim().split(".");
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > Number(preview.maximumCents)) throw new Error("金额超过可申请额度");
    const reason = await ElMessageBox.prompt("请填写单独退运费的审批依据", "退运费原因", {
      inputValidator: (value) => (value.trim().length >= 2 && value.trim().length <= 256) || "请填写2至256字原因",
    });
    const signature = JSON.stringify([amountCents, reason.value.trim()]);
    const cached = shippingRequestKeys.get(String(row.id));
    const key = cached?.signature === signature ? cached.key : crypto.randomUUID();
    shippingRequestKeys.set(String(row.id), { signature, key });
    await api.post(`/commerce-orders/${encodeURIComponent(String(row.id))}/shipping-refunds`, {
      amountCents,
      reason: reason.value.trim(),
      orderVersion: preview.orderVersion,
      requestKey: key,
    });
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
  ++editorRequestId;
  ++deviceDetailRequestId;
  ++memberDevicesRequestId;
  articleCategoriesReady.value = false;
  articleCategoryEditorResource.value = "";
  articleCategoryOptions.value = [];
  originalArticleCategoryId.value = null;
  loading.value = false;
  loadError.value = "";
  rows.value = [];
  resourceMeta.value = {};
  search.value = "";
  commerceStatus.value = "";
  appProductFilter.value = "";
  currentPage.value = 1;
  dialogVisible.value = false;
  deviceDetailVisible.value = false;
  deviceDetailLoading.value = false;
  deviceDetail.value = {};
  deviceConnections.value = [];
  memberDevicesVisible.value = false;
  memberDevicesLoading.value = false;
  memberDeviceMember.value = {};
  memberDevices.value = [];
  detailRows.value = [];
  healthMember.value = {};
  form.value = {};
}

watch(
  resource,
  async () => {
    resetResourceView();
    await load();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  ++loadRequestId;
  ++healthRequestId;
  ++editorRequestId;
});
</script>

<template>
  <section class="page">
    <h1 class="page-title">{{ title }}</h1>
    <div class="resource-content">
      <CommerceWorkspace v-if="isCommerceResource" v-model:search="search" :resource="resource" :rows="rows" :meta="resourceMeta" :loading="loading" :createable="createable" @refresh="refreshCommerce" @page-change="changeCommercePage" @status-change="changeCommerceStatus" @create="openCreate" @edit="openEdit" @delete-product="deleteCommerceProduct" @refund="refundAfterSale" @ship="openShipment" @shipping-refund="requestShippingRefund" @run-action="runAction" @batch-products="batchProducts" />
      <template v-else>
        <div class="toolbar">
          <el-select v-if="resource === 'health-reports'" v-model="reportType" placeholder="全部报告" clearable style="width: 180px" @change="load"><el-option label="健康报告" value="health" /><el-option label="睡眠报告" value="sleep" /></el-select>
          <el-select v-if="['articles', 'legal-documents', 'settings'].includes(resource)" v-model="appProductFilter" placeholder="全部前端 App" clearable style="width: 190px"><el-option v-for="item in contentProductOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          <el-input v-if="searchable" v-model="search" placeholder="邮箱、会员编号、手机号、昵称或推广码" clearable style="width: 340px" @keyup.enter="searchMembers" @clear="searchMembers" />
          <el-button v-if="resource === 'members'" :loading="loading" @click="searchMembers">搜索</el-button>
          <el-button type="primary" @click="load">刷新</el-button>
          <el-button v-if="createable" @click="openCreate">新增</el-button>
          <span class="muted">{{ resource === "devices" ? "设备标识由 App 上报标识单向生成，用于蓝牙名或 MAC 缺失时区分设备。" : "会员手机号仅在已登录后台显示；健康原始数据仍按角色授权。" }}</span>
        </div>
        <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
        <el-table v-if="!loadError" v-loading="loading" :data="visibleRows" border stripe :empty-text="resource === 'members' ? (loading ? '正在加载会员…' : search ? '未找到匹配会员，请检查搜索条件' : '暂无会员') : '暂无记录'">
          <el-table-column v-for="column in columns" :key="column" :prop="column" :label="fieldLabels[column] || column" :min-width="resource === 'members' && column === 'referrerProfile' ? 280 : resource === 'members' && ['emailMasked', 'mobile'].includes(column) ? 220 : column === 'avatarUrl' ? 78 : 145" :show-overflow-tooltip="!(resource === 'members' && column === 'referrerProfile')">
            <template #default="scope">
              <el-avatar v-if="resource === 'members' && column === 'avatarUrl'" :size="38" :src="scope.row.avatarUrl || undefined">{{ String(scope.row.nickname || "会员").slice(0, 1) }}</el-avatar>
              <div v-else-if="resource === 'members' && column === 'promotionCode'" style="display: grid; gap: 4px">
                <span>{{ scope.row.promotionCode || "未生成" }}</span>
                <el-tag v-if="scope.row.promotionCode && scope.row.promotionActive === false" size="small" type="danger">已停用</el-tag>
              </div>
              <div v-else-if="resource === 'members' && column === 'referrerProfile'" class="member-referrer">
                <template v-if="scope.row.referrerProfile">
                  <el-avatar :size="38" :src="scope.row.referrerProfile.avatarUrl || undefined">{{ String(scope.row.referrerProfile.name || "上级").slice(0, 1) }}</el-avatar>
                  <div>
                    <b>{{ scope.row.referrerProfile.name || "未填写昵称" }}</b>
                    <span>{{ scope.row.referrerProfile.mobile || "未填写手机号" }}</span>
                    <span>推广码：{{ scope.row.referrerProfile.referralCode }}</span>
                  </div>
                </template>
                <span v-else class="muted">无推广上级</span>
              </div>
              <span v-else-if="resource === 'members' && column === 'pointBalanceCents'">{{ pointMoney(scope.row.pointBalanceCents) }}</span>
              <div v-else-if="resource === 'members' && ['emailMasked', 'mobile'].includes(column)" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
                <span>{{ render(scope.row[column]) }}</span>
                <el-tag size="small" :type="scope.row[column === 'mobile' ? 'mobileVerified' : 'emailVerified'] ? 'success' : scope.row[column] ? 'warning' : 'info'">
                  {{ contactVerificationLabel(scope.row, column === "mobile" ? "mobile" : "email") }}
                </el-tag>
              </div>
              <div v-else-if="resource === 'devices' && column === 'capabilities'" style="display: flex; gap: 6px; flex-wrap: wrap">
                <el-tag v-for="capability in deviceCapabilities(scope.row[column])" :key="capability" size="small" effect="plain">{{ deviceCapabilityLabel(capability) }}</el-tag>
                <span v-if="!deviceCapabilities(scope.row[column]).length" class="muted">未上报</span>
              </div>
              <span v-else-if="needsArticleCategories && column === 'locale'">{{ contentLocales.find((item) => item.value === scope.row.locale)?.label ?? scope.row.locale ?? '未标注' }}</span>
              <el-tag v-else-if="resource === 'articles' && column === 'product'" size="small" :type="scope.row.product === 'say-ring' ? 'warning' : scope.row.product === 'shared' ? 'info' : 'primary'">{{ contentProductLabel(scope.row.product ?? 'shared') }}</el-tag>
              <div v-else-if="resource === 'settings' && column === 'appScope'" class="app-scope-tags"><el-tag v-for="product in rowProducts(scope.row)" :key="product" size="small" :type="product === 'say-ring' ? 'warning' : 'primary'">{{ contentProductLabel(product) }}</el-tag></div>
              <el-tag v-else-if="resource === 'devices' && column === 'status'" size="small" :type="scope.row.status === 'BOUND' ? 'success' : 'info'">{{ scope.row.status === "BOUND" ? "已绑定" : scope.row.status === "UNBOUND" ? "已解绑" : render(scope.row.status) }}</el-tag>
              <el-tag v-else-if="resource === 'legal-documents' && column === 'legalProduct'" size="small" :type="legalProductForDocumentType(scope.row.documentType) === 'say-ring' ? 'warning' : 'primary'">{{ legalProductForDocumentType(scope.row.documentType) === "say-ring" ? "Say Ring" : "Saydian Health" }}</el-tag>
              <span v-else-if="resource === 'legal-documents' && column === 'documentType'">{{ legalDocumentTypeLabel(scope.row.documentType) }}</span>
              <el-tag v-else-if="resource === 'legal-documents' && ['active', 'reviewed'].includes(column)" size="small" :type="scope.row[column] ? 'success' : 'info'">{{ scope.row[column] ? "是" : "否" }}</el-tag>
              <template v-else>{{ render(scope.row[column]) }}</template>
            </template>
          </el-table-column>
          <el-table-column v-if="resource === 'members'" label="健康数据" width="230" fixed="right">
            <template #default="scope">
              <el-button size="small" @click="viewHealth(scope.row, false)">查看摘要</el-button>
              <el-button v-if="canReadRawHealth" size="small" type="warning" plain @click="viewHealth(scope.row, true)">原始记录</el-button>
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite && resource === 'feedback'" label="处理" width="110" fixed="right">
            <template #default="scope">
              <el-button size="small" type="primary" plain @click="openFeedback(scope.row)">{{ scope.row.replyContent ? "查看 / 回复" : "处理 / 回复" }}</el-button>
            </template>
          </el-table-column>
          <el-table-column v-if="resource === 'devices'" label="操作" width="100" fixed="right">
            <template #default="scope">
              <el-button size="small" type="primary" plain @click="openDeviceDetails(scope.row)">查看详情</el-button>
            </template>
          </el-table-column>
          <el-table-column v-if="resource === 'members' || editable || (canWrite && resource === 'health-reports')" label="操作" :min-width="resource === 'members' ? 180 : 110" fixed="right">
            <template #default="scope">
              <el-button v-if="resource === 'members'" size="small" type="primary" plain @click="openMemberDevices(scope.row)">查看设备</el-button>
              <el-button v-if="editable" size="small" :disabled="resource === 'members' && ['DELETION_PENDING', 'DELETED'].includes(scope.row.status)" @click="openEdit(scope.row)">编辑</el-button>
              <el-button v-if="resource === 'health-reports' && canReadRawHealth" size="small" type="primary" plain @click="openHealthReport(scope.row)">查看</el-button>
              <el-button v-if="canWrite && resource === 'health-reports' && scope.row.status === 'FAILED'" size="small" type="warning" @click="runAction(`/health-reports/${scope.row.id}/retry`, '报告已重新排队')">重试</el-button>
              <el-button v-if="canWrite && resource === 'notification-campaigns' && scope.row.status === 'DRAFT'" size="small" type="primary" @click="runAction(`/notification-campaigns/${scope.row.id}/schedule`, '通知已安排发送')">安排发送</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination v-if="resource === 'members' && !loadError" :current-page="currentPage" :page-size="memberPageSize" :total="Number(resourceMeta.total ?? 0)" :disabled="loading" layout="total, prev, pager, next" style="margin-top: 16px" @current-change="changeCommercePage" />
      </template>
    </div>

    <el-dialog v-model="memberDevicesVisible" title="会员设备" width="min(980px, 94vw)" destroy-on-close @closed="++memberDevicesRequestId">
      <div v-loading="memberDevicesLoading">
        <p>{{ memberDeviceMember.memberNo || "—" }} · {{ memberDeviceMember.memberNickname || "未填写昵称" }}</p>
        <el-table :data="memberDevices" border stripe empty-text="暂无设备上报">
          <el-table-column prop="deviceIdentifier" label="设备标识" min-width="190" />
          <el-table-column prop="bluetoothName" label="蓝牙名称" min-width="150" />
          <el-table-column prop="model" label="设备型号" min-width="120" />
          <el-table-column prop="macAddress" label="MAC 地址" min-width="160"><template #default="scope">{{ scope.row.macAddress || "未上报" }}</template></el-table-column>
          <el-table-column label="最近连接" min-width="190"><template #default="scope">{{ localDateTime(scope.row.lastSeenAt) }}</template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="scope">{{ scope.row.status === "BOUND" ? "已绑定" : "已解绑" }}</template></el-table-column>
          <el-table-column label="操作" width="110"><template #default="scope"><el-button size="small" type="primary" plain @click="openDeviceDetails(scope.row)">连接记录</el-button></template></el-table-column>
        </el-table>
      </div>
      <template #footer><el-button @click="memberDevicesVisible = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog v-model="deviceDetailVisible" title="设备连接详情" width="min(920px, 94vw)" destroy-on-close @closed="closeDeviceDetails">
      <div v-loading="deviceDetailLoading">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="会员">{{ deviceDetail.memberNo || "—" }} · {{ deviceDetail.memberNickname || "未填写昵称" }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ deviceDetail.status === "BOUND" ? "已绑定" : deviceDetail.status === "UNBOUND" ? "已解绑" : "—" }}</el-descriptions-item>
          <el-descriptions-item label="蓝牙名称">{{ deviceDetail.bluetoothName || "—" }}</el-descriptions-item>
          <el-descriptions-item label="设备型号">{{ deviceDetail.model || "—" }}</el-descriptions-item>
          <el-descriptions-item label="设备标识">{{ deviceDetail.deviceIdentifier || "—" }}</el-descriptions-item>
          <el-descriptions-item label="MAC 地址">{{ deviceDetail.macAddress || "未上报" }}</el-descriptions-item>
          <el-descriptions-item label="固件版本">{{ deviceDetail.firmware || "—" }}</el-descriptions-item>
          <el-descriptions-item label="绑定时间">{{ localDateTime(deviceDetail.boundAt) }}</el-descriptions-item>
          <el-descriptions-item label="最近连接">{{ localDateTime(deviceDetail.lastSeenAt) }}</el-descriptions-item>
        </el-descriptions>
        <el-tabs v-model="deviceHistoryTab" class="device-history-tabs" @tab-change="changeDeviceHistoryTab">
          <el-tab-pane label="连接记录" name="connections">
            <el-table :data="deviceConnections" border stripe empty-text="暂无历史；记录从本功能上线后开始">
              <el-table-column type="expand" width="48">
                <template #default="scope">
                  <div class="device-raw-payload">
                    <b>原始上报数据</b>
                    <pre>{{ scope.row.rawPayload || "历史记录未保存原始数据" }}</pre>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="连接时间" min-width="190"><template #default="scope">{{ localDateTime(scope.row.connectedAt) }}</template></el-table-column>
              <el-table-column prop="bluetoothName" label="蓝牙名称" min-width="150" />
              <el-table-column prop="model" label="设备型号" min-width="120" />
              <el-table-column prop="deviceIdentifier" label="设备标识" min-width="190" />
              <el-table-column prop="macAddress" label="MAC 地址" min-width="160"><template #default="scope">{{ scope.row.macAddress || "未上报" }}</template></el-table-column>
              <el-table-column prop="firmware" label="固件版本" min-width="110" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="测量记录" name="measurements" :disabled="deviceDetailLoading" lazy>
            <div v-loading="deviceMeasurementsLoading">
              <el-alert v-if="deviceMeasurementsMessage" :title="deviceMeasurementsMessage" :closable="false" type="info" />
              <el-table :data="deviceMeasurements" border stripe empty-text="暂无此设备关联的测量记录">
                <el-table-column type="expand" width="48">
                  <template #default="scope">
                    <div class="device-raw-payload"><b>记录原始字段</b><pre>{{ healthRawJson(scope.row) }}</pre></div>
                  </template>
                </el-table-column>
                <el-table-column label="测量时间" min-width="190"><template #default="scope">{{ healthTime(scope.row.observedAt, scope.row.timezoneOffsetMinutes) }}</template></el-table-column>
                <el-table-column label="测量类型" min-width="120"><template #default="scope">{{ healthMetricLabel(scope.row.metric) }}</template></el-table-column>
                <el-table-column label="测量值" min-width="190"><template #default="scope">{{ healthReadings(scope.row).map((item) => `${item.label} ${item.text}`).join("；") }}</template></el-table-column>
                <el-table-column prop="deviceIdentifier" label="设备标识" min-width="190"><template #default="scope">{{ scope.row.deviceIdentifier || "未上报" }}</template></el-table-column>
                <el-table-column prop="sourceModel" label="设备型号" min-width="120"><template #default="scope">{{ scope.row.sourceModel || "未上报" }}</template></el-table-column>
                <el-table-column prop="sourceMeasurementSource" label="测量来源类型" min-width="130"><template #default="scope">{{ scope.row.sourceMeasurementSource || "未上报" }}</template></el-table-column>
              </el-table>
              <el-pagination v-if="deviceMeasurementTotal > 50" :current-page="deviceMeasurementPage" :page-size="50" :total="deviceMeasurementTotal" layout="total, prev, pager, next" style="margin-top: 12px" @current-change="changeDeviceMeasurementPage" />
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer><el-button @click="deviceDetailVisible = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog v-model="shipmentVisible" title="本地商品分包发货" width="min(860px, 94vw)" :close-on-click-modal="false" destroy-on-close>
      <el-alert v-if="shipmentPreview.unavailableReason" :title="shipmentPreview.unavailableReason" type="warning" :closable="false" />
      <p>只登记实际交运的包裹，可分多次发货。ERP 或售后归属不明确的订单需先核验。</p>
      <el-table :data="shipmentPreview.items ?? []" border>
        <el-table-column label="商品 / 规格" min-width="150"
          ><template #default="scope"
            ><div>{{ scope.row.name }}</div>
            <small class="muted">{{ scope.row.specification || "规格未获取" }}</small></template
          ></el-table-column
        >
        <el-table-column prop="quantity" label="购买" width="65" />
        <el-table-column prop="shippedQuantity" label="已发" width="65" />
        <el-table-column prop="afterSaleReservedQuantity" label="售后占用" width="90" />
        <el-table-column prop="refundedQuantity" label="已退" width="65" />
        <el-table-column prop="remainingQuantity" label="可发" width="65" />
        <el-table-column label="本包裹数量" width="175"
          ><template #default="scope"><el-input-number v-model="shipmentForm.quantities[scope.row.orderItemId]" :min="0" :max="scope.row.remainingQuantity" :precision="0" :disabled="!!shipmentPreview.unavailableReason || shipmentBusy" /></template
        ></el-table-column>
      </el-table>
      <el-form label-width="90px" style="margin-top: 20px">
        <el-form-item label="承运公司"><el-input v-model="shipmentForm.logisticsCompany" maxlength="60" placeholder="填写实际承运公司" :disabled="shipmentBusy" /></el-form-item>
        <el-form-item label="运单号"><el-input v-model="shipmentForm.trackingNo" maxlength="100" placeholder="填写实际运单号；同单号重复提交不会重复登记" :disabled="shipmentBusy" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="shipmentBusy" @click="shipmentVisible = false">关闭</el-button><el-button type="primary" :loading="shipmentBusy" :disabled="!!shipmentPreview.unavailableReason" @click="saveShipment">登记包裹</el-button></template>
    </el-dialog>
    <AdminHealthReportDialog v-model="healthReportVisible" :row="healthReportRow" :can-edit="canEditHealthReport" @saved="load" />
    <el-dialog v-model="feedbackVisible" title="处理会员反馈" width="min(680px, 94vw)" :close-on-click-modal="false" destroy-on-close>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="会员">{{ feedbackForm.memberNickname || "未填写昵称" }}{{ feedbackForm.memberNo ? ` · 会员 ${feedbackForm.memberNo}` : "" }}</el-descriptions-item>
        <el-descriptions-item label="问题分类">{{ render(feedbackForm.category) }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ render(feedbackForm.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="反馈内容"
          ><div style="white-space: pre-wrap; overflow-wrap: anywhere">
            {{ feedbackForm.content }}
          </div></el-descriptions-item
        >
        <el-descriptions-item v-if="feedbackForm.contact" label="联系方式">{{ feedbackForm.contact }}</el-descriptions-item>
      </el-descriptions>
      <el-form label-width="90px" style="margin-top: 18px">
        <el-form-item label="处理状态"
          ><el-select v-model="feedbackForm.status" style="width: 100%"><el-option label="待处理" value="OPEN" /><el-option label="处理中" value="IN_PROGRESS" /><el-option label="已解决" value="RESOLVED" /><el-option label="已关闭" value="CLOSED" /></el-select
        ></el-form-item>
        <el-form-item label="回复会员"><el-input v-model="feedbackForm.replyContent" type="textarea" :rows="6" maxlength="2000" show-word-limit placeholder="保存后发送 App 站内通知，会员也可在客服中心查看回复" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="feedbackSaving" @click="feedbackVisible = false">关闭</el-button><el-button type="primary" :loading="feedbackSaving" @click="saveFeedback">保存处理结果</el-button></template>
    </el-dialog>
    <el-dialog v-model="dialogVisible" :title="dialogTitle" :width="dialogMode === 'health' ? 'min(960px, 94vw)' : resource === 'settings' && isAppUpdateSetting(form.key) ? '980px' : ['articles', 'legal-documents'].includes(resource) ? 'min(980px, 94vw)' : '720px'" destroy-on-close>
      <div v-if="dialogMode === 'health'">
        <MemberHealthData :mode="healthMode" :rows="detailRows" :member-no="healthMember.memberNo" />
        <MemberHealthReportPanel v-if="dialogVisible && healthMode === 'summary' && canReadRawHealth" :key="healthMember.id" :member-id="healthMember.id" />
      </div>
      <el-form v-else label-width="110px">
        <el-form-item v-if="needsArticleCategories" label="语言">
          <el-select :model-value="form.locale" placeholder="请选择语言" @change="changeContentLocale">
            <el-option v-for="item in contentLocales" :key="item.value" :value="item.value" :label="item.label" />
          </el-select>
        </el-form-item>
        <template v-if="resource === 'members'">
          <el-alert title="手机号、邮箱、密码或验证状态变更后，系统会注销该会员现有会话，会员需重新登录。联系方式发生变化时验证开关会自动关闭；请在确实完成人工核实后再开启。" type="warning" :closable="false" show-icon />
          <el-form-item label="会员编号"><el-input v-model="form.memberNo" disabled /></el-form-item>
          <el-divider content-position="left">会员填写的基本资料</el-divider>
          <el-form-item label="头像">
            <div style="display: flex; align-items: center; gap: 12px; width: 100%">
              <el-avatar :size="52" :src="form.avatarUrl || undefined">{{ String(form.nickname || "会员").slice(0, 1) }}</el-avatar>
              <el-input v-model="form.avatarUrl" clearable placeholder="图片 HTTP/HTTPS 地址；留空可清除" />
            </div>
          </el-form-item>
          <el-form-item label="姓名/昵称"><el-input v-model="form.nickname" maxlength="40" show-word-limit placeholder="会员在 App 中填写的称呼" /></el-form-item>
          <el-form-item label="性别">
            <el-select v-model="form.gender" style="width: 100%"><el-option label="未设置" value="UNSPECIFIED" /><el-option label="男" value="MALE" /><el-option label="女" value="FEMALE" /></el-select>
          </el-form-item>
          <el-form-item label="出生日期">
            <el-date-picker v-model="form.birthday" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" clearable :disabled-date="memberBirthdayDisabled" style="width: 100%" placeholder="选择出生日期" />
          </el-form-item>
          <el-form-item label="身高"> <el-input-number v-model="form.heightCm" :min="50" :max="250" :precision="1" :step="0.1" controls-position="right" /><span class="muted" style="margin-left: 10px">厘米，可留空</span> </el-form-item>
          <el-form-item label="体重"> <el-input-number v-model="form.weightKg" :min="10" :max="500" :precision="1" :step="0.1" controls-position="right" /><span class="muted" style="margin-left: 10px">千克，可留空</span> </el-form-item>
          <el-divider content-position="left">登录与联系方式</el-divider>
          <el-form-item label="手机号">
            <el-input :model-value="form.mobile" clearable placeholder="国内填写11位手机号；国际号码请带国家区号" @input="onMemberContactInput('mobile', $event)" />
          </el-form-item>
          <el-form-item label="手机已核实">
            <el-switch v-model="form.mobileVerified" :disabled="!form.mobile" active-text="已验证" inactive-text="未验证" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input :model-value="form.email" clearable placeholder="例如 member@example.com" @input="onMemberContactInput('email', $event)" />
          </el-form-item>
          <el-form-item label="邮箱已核实">
            <el-switch v-model="form.emailVerified" :disabled="!form.email" active-text="已验证" inactive-text="未验证" />
          </el-form-item>
          <el-form-item label="账号状态">
            <el-select v-model="form.status"><el-option label="正常" value="ACTIVE" /><el-option label="停用" value="DISABLED" /></el-select>
          </el-form-item>
          <el-form-item label="推广上级 ID">
            <div style="width: 100%">
              <el-select v-model="form.referralEmployeeId" clearable filterable placeholder="可搜索员工姓名、推广码或 ID；留空则清除" style="width: 100%">
                <el-option v-for="item in memberReferralOptions" :key="item.id" :value="item.id" :label="`${item.name} · ${item.referralCode} · ${item.id}`" :disabled="item.active === false && item.id !== form._originalReferralEmployeeId" />
              </el-select>
              <span class="muted">关联推广员工，只影响之后未携带有效推广链接的新订单；不会修改历史订单和奖金。</span>
            </div>
          </el-form-item>
          <el-divider content-position="left">会员积分</el-divider>
          <el-form-item label="当前积分"
            ><b>{{ pointMoney(form.pointBalanceCents) }}</b></el-form-item
          >
          <el-form-item label="调整金额"
            ><el-input v-model="form.pointAdjustment" inputmode="decimal" placeholder="例如 20.00；扣减填写 -5.00" clearable><template #append>元</template></el-input></el-form-item
          >
          <el-form-item label="调整原因"><el-input v-model="form.pointAdjustmentReason" maxlength="200" show-word-limit placeholder="调整积分时必填，会写入审计日志" /></el-form-item>
          <el-alert title="积分按可抵扣金额管理。扣减后余额不能小于0，每次调整都会生成会员可见流水和后台审计记录。" type="info" :closable="false" show-icon />
          <el-form-item label="新密码"><el-input v-model="form.newPassword" type="password" show-password maxlength="72" autocomplete="new-password" placeholder="留空则不修改；至少8位" /></el-form-item>
          <p class="muted">后台不能查看原密码。修改密码后，该会员所有已登录设备都会退出。保存操作会记录管理员、时间和变更字段，审计日志不会保存密码、完整手机号、邮箱或会员资料值。</p>
        </template>
        <template v-else-if="resource === 'commerce-commissions'">
          <el-alert title="奖金规则只影响新支付订单；已有奖金使用原快照。提现仅可使用可用余额，仍需财务人工审核。" type="info" :closable="false" />
          <el-form-item label="启用奖金"><el-switch v-model="form.enabled" /></el-form-item>
          <el-form-item label="推广奖金比例"><el-input-number v-model="form.rateBps" :min="0" :max="10000" :precision="0" /><span class="muted">基点（100 = 1%），只影响之后支付的新订单</span></el-form-item>
          <el-form-item label="收货等待天数"><el-input-number v-model="form.settlementDays" :min="0" :max="3650" :precision="0" /></el-form-item>
          <el-form-item label="启用提现"><el-switch v-model="form.withdrawalEnabled" /></el-form-item>
          <el-form-item label="最低提现（分）"><el-input-number v-model="form.minimumWithdrawCents" :min="1" :precision="0" placeholder="未配置时无法提现" /></el-form-item>
          <el-form-item label="每日额度（分）"><el-input-number v-model="form.dailyWithdrawLimitCents" :min="1" :precision="0" placeholder="不填则无额外限制" /></el-form-item>
          <el-form-item label="人工审核"><el-switch v-model="form.reviewRequired" disabled /></el-form-item>
        </template>
        <template v-else-if="resource === 'articles'">
          <el-alert title="封面和正文图片可直接上传；正文会按安全 HTML 保存，发布前请预览排版与链接。" type="info" :closable="false" show-icon />
          <el-form-item label="所属 App"><el-select v-model="form.product"><el-option v-for="item in contentProductOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" maxlength="200" show-word-limit /></el-form-item>
          <el-form-item label="摘要"><el-input v-model="form.summary" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item>
          <el-form-item label="内容分类">
            <el-select v-model="form.categoryId" clearable filterable placeholder="请选择分类；可留空">
              <el-option v-if="form.categoryId && !articleCategoryOptions.some((item) => item.id === form.categoryId)" :value="form.categoryId" label="原分类（当前不可用，可清除或重新选择）" disabled />
              <el-option v-for="item in selectableArticleCategories" :key="item.id" :value="item.id" :label="articleCategoryLabel(item)" :disabled="item.enabled === false && item.id !== originalArticleCategoryId" />
            </el-select>
          </el-form-item>
          <el-form-item label="封面图片"><ContentImageField v-model="form.coverUrl" /></el-form-item>
          <el-form-item label="正文"><RichTextEditor v-model="form.contentHtml" /></el-form-item>
          <el-form-item label="状态"
            ><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="已发布" value="PUBLISHED" /></el-select
          ></el-form-item>
        </template>
        <template v-else-if="resource === 'article-categories'">
          <el-form-item v-if="form.id" label="分类编号"><el-input :model-value="render(form.categoryNo)" readonly /></el-form-item>
          <el-form-item label="分类名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="上级分类">
            <el-select v-model="form.parentId" clearable filterable placeholder="不选则为一级分类">
              <el-option v-if="form.parentId && !articleCategoryOptions.some((item) => item.id === form.parentId)" :value="form.parentId" label="原上级分类（当前不可用，可清除或重新选择）" disabled />
              <el-option v-for="item in selectableArticleCategories" :key="item.id" :value="item.id" :label="articleCategoryLabel(item)" :disabled="item.enabled === false && item.id !== originalArticleCategoryId" />
            </el-select>
          </el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        </template>
        <template v-else-if="resource === 'legal-documents'">
          <el-alert :title="form.documentType === 'say_ring_sleep_analysis' ? '睡眠 AI 分析说明只用于 Say Ring。启用前核对供应商、上传范围与撤回方式；已发布内容不可原地修改。此核对不代表外部法律意见。' : 'Saydian Health 与 Say Ring 的协议独立保存、独立调用。新版本需完成法律审核后才能启用；已审核版本不可原地修改。'" type="info" :closable="false" show-icon />
          <el-form-item label="所属 App"><el-select :model-value="form.legalProduct" :disabled="Boolean(form._reviewedSnapshot)" @change="changeLegalDocumentProduct"><el-option label="Saydian Health" value="saydian-global" /><el-option label="Say Ring" value="say-ring" /></el-select></el-form-item>
          <el-form-item label="协议类型">
            <el-select :model-value="form.documentType" :disabled="Boolean(form._reviewedSnapshot)" @change="changeLegalDocumentType">
              <template v-if="form.legalProduct === 'say-ring'"><el-option label="Say Ring 用户协议" value="say_ring_user_agreement" /><el-option label="Say Ring 隐私政策" value="say_ring_privacy_policy" /><el-option label="Say Ring 睡眠 AI 分析说明" value="say_ring_sleep_analysis" /></template>
              <template v-else><el-option label="用户协议" value="user_agreement" /><el-option label="隐私政策" value="privacy_policy" /><el-option label="健康 AI 分析说明" value="health_ai_analysis" /></template>
            </el-select>
          </el-form-item>
          <el-form-item label="语言"><el-select v-model="form.locale" :disabled="Boolean(form._reviewedSnapshot)"><el-option label="English" value="en" /><el-option label="简体中文" value="zh-Hans" /><el-option label="繁體中文" value="zh-Hant" /></el-select></el-form-item>
          <el-form-item label="版本"><el-input v-model="form.version" :disabled="Boolean(form._reviewedSnapshot)" /></el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" :disabled="Boolean(form._reviewedSnapshot)" /></el-form-item>
          <el-form-item label="正文"><RichTextEditor v-model="form.contentHtml" :readonly="Boolean(form._reviewedSnapshot)" /></el-form-item>
          <el-form-item :label="form.documentType === 'say_ring_sleep_analysis' ? '说明内容已核对' : '法律审核完成'"><el-switch v-model="form.reviewed" :disabled="Boolean(form._reviewedSnapshot)" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.active" :disabled="form.reviewed !== true" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-products'">
          <template v-if="form._erpLookupPending">
            <el-alert title="填写 ERP SKU 后，系统会实时调用聚水潭商品与库存接口；两项都成功才会按草稿导入，不依赖同步任务。" type="info" :closable="false" show-icon />
            <el-alert v-if="erpLookupError" :title="erpLookupError" type="error" :closable="false" show-icon style="margin-top: 12px" />
            <el-form-item label="ERP SKU（必填）">
              <div style="display: flex; width: 100%; gap: 12px">
                <el-input v-model="form._erpLookupSku" placeholder="填写 ERP 系统中的 SKU" clearable @input="erpLookupError = ''" @keyup.enter="loadCommerceProductBySku" />
                <el-button type="primary" :loading="erpLookupBusy" @click="loadCommerceProductBySku">获取 ERP 资料</el-button>
              </div>
            </el-form-item>
          </template>
          <template v-else>
            <el-alert v-if="form.source === 'ERP'" title="ERP 名称、编码、SKU、售价和库存已从聚水潭实时刷新；此处保存商城展示资料，后续同步仍会更新 ERP 权威字段。" type="success" :closable="false" show-icon />
            <el-form-item label="商品来源"
              ><el-tag>{{ form.source === "LOCAL" ? "本地商品" : "ERP同步商品" }}</el-tag></el-form-item
            >
            <el-form-item v-if="form.source === 'ERP'" label="匹配 SKU">
              <el-space wrap
                ><el-tag v-for="sku in form.skus" :key="sku.id || sku.erpSkuId" type="info">{{ sku.erpSkuId }}</el-tag></el-space
              >
            </el-form-item>
            <el-form-item v-if="form._erpSnapshotText" label="ERP 实时资料">
              <el-collapse style="width: 100%">
                <el-collapse-item title="查看聚水潭完整返回字段（只读）">
                  <el-input :model-value="form._erpSnapshotText" type="textarea" :rows="12" readonly resize="vertical" />
                </el-collapse-item>
              </el-collapse>
            </el-form-item>
            <el-form-item label="商品编号"><el-input v-model="form.erpItemId" :disabled="form.source !== 'LOCAL'" placeholder="留空自动生成" /></el-form-item>
            <el-form-item label="商品名称"><el-input v-model="form.name" :disabled="form.source !== 'LOCAL'" /></el-form-item>
            <el-form-item label="展示名称"><el-input v-model="form.displayName" /></el-form-item>
            <el-form-item label="副标题"><el-input v-model="form.subtitle" /></el-form-item>
            <el-form-item label="品牌"><el-input v-model="form.brand" /></el-form-item>
            <el-form-item label="商城分类"
              ><el-select v-model="form.categoryId" clearable filterable placeholder="请选择分类"><el-option v-for="item in categoryOptions" :key="item.id" :label="item.parent?.name ? `${item.parent.name} / ${item.name}` : item.name" :value="item.id" /></el-select
            ></el-form-item>
            <el-form-item label="商品封面"><ContentImageField v-model="form.coverImage" upload-url="/commerce-images" /></el-form-item>
            <el-form-item label="相册上传"><ContentImageField :model-value="''" upload-url="/commerce-images" @update:model-value="appendProductGalleryImage" /></el-form-item>
            <el-form-item label="相册地址"><el-input v-model="form.galleryText" type="textarea" :rows="4" placeholder="每行一个图片地址" /></el-form-item>
            <el-form-item label="标签"><el-input v-model="form.tagsText" placeholder="多个标签用逗号分隔" /></el-form-item>
            <el-form-item label="商品详情"><RichTextEditor v-model="form.detailHtml" /></el-form-item>
            <el-form-item label="商品规格">
              <div style="width: 100%">
                <el-table :data="form.skus" border>
                  <el-table-column label="规格"
                    ><template #default="scope"><el-input v-if="form.source === 'LOCAL'" v-model="scope.row.specification" /><span v-else>{{ scope.row.specification || '—' }}</span></template
                  ></el-table-column>
                  <el-table-column label="SKU编码"
                    ><template #default="scope"><el-input v-if="form.source === 'LOCAL'" v-model="scope.row.erpSkuId" placeholder="自动生成" /><span v-else>{{ scope.row.erpSkuId }}</span></template
                  ></el-table-column>
                  <el-table-column label="规格图片" min-width="270"><template #default="scope"><ContentImageField v-model="scope.row.image" upload-url="/commerce-images" compact /></template></el-table-column>
                  <el-table-column label="售价（分）" width="145"
                    ><template #default="scope"><el-input-number v-if="form.source === 'LOCAL'" v-model="scope.row.salePriceCents" :min="1" controls-position="right" style="width: 120px" /><span v-else>{{ scope.row.salePriceCents }}</span></template
                  ></el-table-column>
                  <el-table-column label="库存" width="130"
                    ><template #default="scope"><el-input-number v-if="form.source === 'LOCAL'" v-model="scope.row.stock" :min="0" controls-position="right" style="width: 105px" /><span v-else>{{ scope.row.stock }}</span></template
                  ></el-table-column>
                  <el-table-column v-if="form.source === 'LOCAL'" label="启用" width="65"
                    ><template #default="scope"><el-switch v-model="scope.row.enabled" /></template
                  ></el-table-column>
                </el-table>
                <el-button
                  v-if="form.source === 'LOCAL'"
                  style="margin-top: 8px"
                  @click="
                    form.skus.push({
                      specification: '',
                      salePriceCents: 1,
                      stock: 0,
                      enabled: true,
                    })
                  "
                  >添加规格</el-button
                >
              </div>
            </el-form-item>
            <el-form-item label="状态"
              ><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="在售" value="PUBLISHED" /><el-option label="下架" value="OFF_SHELF" /></el-select
            ></el-form-item>
            <el-form-item label="首页推荐"><el-switch v-model="form.featured" /></el-form-item>
            <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
          </template>
        </template>
        <template v-else-if="resource === 'commerce-categories'">
          <el-form-item label="分类名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="上级分类"
            ><el-select v-model="form.parentId" clearable filterable placeholder="不选则为一级分类"><el-option v-for="item in categoryOptions.filter((item) => item.id !== form.id)" :key="item.id" :label="item.name" :value="item.id" /></el-select
          ></el-form-item>
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
          <el-form-item label="处理状态"
            ><el-select v-model="form.status"
              ><el-option
                v-for="status in [...new Set([rows.find((row) => row.id === form.id)?.status, ...(form.allowedTransitions || [])])].filter(Boolean)"
                :key="status"
                :label="
                  (
                    {
                      APPLIED: '已申请',
                      REVIEWING: '审核中',
                      APPROVED: '通过',
                      REJECTED: '拒绝',
                      WAITING_RETURN: '等待退货',
                      RETURNED: '已退回',
                      CANCELLED: '已取消',
                      REFUNDING: '退款中',
                      COMPLETED: '已完成',
                    } as Record<string, string>
                  )[status] || status
                "
                :value="status" /></el-select
          ></el-form-item>
          <el-form-item label="退货物流"><el-input v-model="form.returnLogisticsCompany" /></el-form-item>
          <el-form-item label="退货单号"><el-input v-model="form.returnTrackingNo" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-coupons'">
          <el-alert title="优惠码可由顾客在结算页输入领取；优惠金额、门槛和有效期仍由服务端按本券配置计算。" type="info" :closable="false" show-icon />
          <el-form-item label="优惠券名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="优惠码（选填）"><el-input v-model="form.redemptionCode" maxlength="32" placeholder="如 SAVE10，仅支持字母、数字、_ 和 -" /></el-form-item>
          <el-form-item label="优惠金额（分）"><el-input-number v-model="form.value" :min="1" /></el-form-item>
          <el-form-item label="最低消费（分）"><el-input-number v-model="form.minimumSpendCents" :min="0" /></el-form-item>
          <el-form-item label="发行数量"><el-input-number v-model="form.totalQuantity" :min="1" /></el-form-item>
          <el-form-item label="生效时间" required><el-date-picker v-model="form.validFrom" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" placeholder="请选择生效时间" style="width: 100%" /></el-form-item>
          <el-form-item label="失效时间" required><el-date-picker v-model="form.validUntil" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" placeholder="请选择失效时间" style="width: 100%" /></el-form-item>
          <el-form-item label="状态"
            ><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="启用" value="ACTIVE" /><el-option label="暂停" value="PAUSED" /><el-option label="已过期" value="EXPIRED" /></el-select
          ></el-form-item>
          <el-form-item label="员工可分发"><el-switch v-model="form.employeeDistributable" /></el-form-item>
          <el-form-item label="员工领取上限"><el-input-number v-model="form.perEmployeeLimit" :min="0" /></el-form-item>
        </template>
        <template v-else-if="resource === 'health-report-offers'">
          <el-alert title="保存已有方案会创建新版本，不会改写已付款订单的历史价格。正式启用前还需真实支付渠道验收。" type="info" :closable="false" show-icon />
          <el-form-item label="方案标识"><el-input v-model="form.offerKey" placeholder="如 single-report" /></el-form-item>
          <el-form-item label="名称"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="说明"><el-input v-model="form.description" type="textarea" /></el-form-item>
          <el-form-item label="权益"
            ><el-select v-model="form.entitlement"><el-option label="单次报告" value="SINGLE_REPORT" /><el-option label="30天健康会员" value="MEMBERSHIP" /></el-select
          ></el-form-item>
          <el-form-item label="价格（分）"><el-input-number v-model="form.priceCents" :min="1" /></el-form-item>
          <el-form-item label="报告次数"><el-input-number v-model="form.creditCount" :min="1" /></el-form-item>
          <el-form-item v-if="form.entitlement === 'MEMBERSHIP'" label="有效天数"><el-input-number v-model="form.durationDays" :min="1" /></el-form-item>
          <el-form-item label="客户端"
            ><el-checkbox-group v-model="form.platforms"><el-checkbox value="android">Android</el-checkbox><el-checkbox value="ios">iOS</el-checkbox><el-checkbox value="h5">H5</el-checkbox><el-checkbox value="mini_program">小程序</el-checkbox></el-checkbox-group></el-form-item
          >
          <el-form-item label="Apple商品ID"><el-input v-model="form.appleProductId" /></el-form-item>
          <el-form-item label="立即启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
        <template v-else-if="resource === 'notification-campaigns'">
          <el-alert title="此入口只发送营销通知；未主动同意营销通知的会员不会收到。订单、售后和健康预警由业务事件发送。" type="info" :closable="false" show-icon />
          <el-form-item label="任务名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="通知类型"
            ><el-select v-model="form.type"><el-option label="系统消息" value="SYSTEM" /><el-option label="活动消息" value="ANNOUNCEMENT" /></el-select
          ></el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="正文"><el-input v-model="form.body" type="textarea" :rows="5" /></el-form-item>
          <el-form-item label="跳转地址"><el-input v-model="form.deepLink" /></el-form-item>
          <el-form-item label="全部已同意用户"><el-switch v-model="form.audienceAllActive" /></el-form-item>
          <el-form-item v-if="!form.audienceAllActive" label="指定会员"><el-input v-model="form.audienceUserIds" type="textarea" :rows="4" placeholder="每行一个会员UUID" /></el-form-item>
          <el-form-item label="计划时间"><el-date-picker v-model="form.scheduledAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" clearable /></el-form-item>
        </template>
        <template v-else-if="resource === 'integrations'">
          <el-form-item label="集成项"><el-input v-model="form.key" disabled /></el-form-item>
          <el-form-item label="运行状态"
            ><el-select v-model="form.state"><el-option label="未启用" value="UNCONFIGURED" /><el-option label="启用并等待真实检测" value="CONFIGURED" /><el-option label="已停用" value="DISABLED" /><el-option label="异常" value="ERROR" /></el-select
          ></el-form-item>
          <el-form-item label="真实检测"
            ><el-tag :type="form.verificationStatus === 'VERIFIED' ? 'success' : form.verificationStatus === 'ERROR' ? 'danger' : 'info'">{{ form.verificationStatus === "VERIFIED" ? "已通过真实调用" : form.verificationStatus === "PENDING" ? "尚未通过真实调用" : form.verificationStatus === "DISABLED" ? "已停用" : "未配置" }}</el-tag></el-form-item
          >
          <el-form-item label="公开配置"><el-input v-model="form.publicConfigText" type="textarea" :rows="10" /></el-form-item>
          <el-form-item label="密钥状态"
            ><el-tag :type="form.hasSecret ? 'success' : 'info'">{{ form.hasSecret ? "已安全保存" : "尚未保存" }}</el-tag></el-form-item
          >
          <el-form-item label="更新密钥"><el-input v-model="form.secretsText" type="password" show-password autocomplete="new-password" placeholder='填写 JSON；留空则保持原密钥，例如 {"apiKey":"..."}' /></el-form-item>
          <el-form-item label="清除密钥"><el-switch v-model="form.clearSecrets" /></el-form-item>
          <el-alert title="密钥使用主机外置主密钥加密，只能覆盖写入，不会在后台或接口中回显。修改配置会清除原检测时间；只有供应商真实调用成功后才显示已通过。" type="info" :closable="false" />
        </template>
        <template v-else-if="resource === 'settings'">
          <el-alert v-if="form._unconfigured" :title="isAppDisplaySetting(form.key) ? '尚未保存显示设置，App 默认显示 AI 内容。调整开关并保存后生效。' : '此项尚未配置。当前内容仅为本次编辑草稿，尚未保存或公开；请填写真实配置后保存。'" type="info" :closable="false" show-icon />
          <el-form-item label="设置项"><el-input v-model="form.key" disabled /></el-form-item>
          <el-form-item v-if="!isAppDisplaySetting(form.key)" label="公开"><el-switch v-model="form.public" /></el-form-item>
          <template v-if="isAppDisplaySetting(form.key)">
            <el-form-item label="隐藏 AI 内容"><el-switch v-model="form.hideAi" active-text="隐藏" inactive-text="显示" /></el-form-item>
            <el-form-item label="AI 睡眠报告"><el-switch v-model="form.sleepAiEnabled" active-text="开启睡眠评分与报告" inactive-text="关闭" /></el-form-item>
            <el-alert title="睡眠 AI 由独立开关控制；开启后仍须会员在 App 主动确认上传及第三方分析。不会同时开启其他 AI 入口。" type="info" :closable="false" />
            <el-alert title="隐藏开关控制 AI 问答和综合健康报告，不影响独立的睡眠报告开关。保存后 App 会在重新打开或回到前台时刷新设置。" type="info" :closable="false" show-icon />
          </template>
          <template v-else-if="isGlobalSupportSetting(form.key) && form.supportEditor">
            <el-alert title="Say Ring 与国际版 App 的“联系客服”页面读取这里的客服电话和微信公众号。旧版误填在 configured 字段里的手机号会自动带入，保存后将转换为正确格式。" type="info" :closable="false" show-icon />
            <el-form-item label="启用客服"><el-switch v-model="form.supportEditor.enabled" /></el-form-item>
            <el-form-item label="客服电话"><el-input v-model="form.supportEditor.phone" maxlength="21" placeholder="如 4006386738" /></el-form-item>
            <el-form-item label="微信公众号"><el-input v-model="form.supportEditor.officialAccount" maxlength="64" placeholder="如 赛电" /></el-form-item>
            <el-form-item label="服务时间"><el-input v-model="form.supportEditor.serviceHours" maxlength="120" placeholder="如 工作日 09:00-18:00" /></el-form-item>
            <el-form-item label="客服说明"><el-input v-model="form.supportEditor.message" type="textarea" :rows="3" maxlength="240" show-word-limit /></el-form-item>
            <el-alert title="启用时至少填写客服电话或微信公众号；关闭后可保留联系方式，但 App 不会展示。" type="warning" :closable="false" />
          </template>
          <template v-else-if="isAppUpdateSetting(form.key) && form.downloadEditor">
            <el-alert :title="form.key === 'say_ring_app_update' ? '仅更新 Say Ring。' : form.key === 'app_update' ? '仅更新原赛电下载页 /down/legacy，不影响 Health。' : '仅更新 Health 下载页 /down 与 /global/down。等待审核时不保存安装链接。'" type="warning" :closable="false" show-icon />
            <el-form-item label="发布时间" class="download-published-at">
              <el-input v-model="form.downloadEditor.publishedAt" placeholder="ISO 8601，如 2026-09-06T00:00:00+08:00">
                <template #append><el-button @click="setDownloadPublishedNow">设为现在</el-button></template>
              </el-input>
            </el-form-item>
            <div class="download-setting-grid">
              <section v-for="platform in visibleDownloadPlatformOptions" :key="platform.key" class="download-platform-card">
                <header>
                  <strong>{{ platform.label }}</strong>
                  <el-tag size="small" :type="form.downloadEditor.releases[platform.key].status === 'available' ? 'success' : 'info'">
                    {{ form.downloadEditor.releases[platform.key].status === "available" ? "可下载" : form.downloadEditor.releases[platform.key].pendingReason === "review" ? "等待审核" : "待开放" }}
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
                <el-form-item v-if="platform.key === 'ios' && form.downloadEditor.releases.ios.status === 'coming_soon'" label="等待审核">
                  <el-switch :model-value="form.downloadEditor.releases.ios.pendingReason === 'review'" @change="(value: boolean | string | number) => form.downloadEditor.releases.ios.pendingReason = value === true ? 'review' : undefined" />
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
                  <el-form-item label="获取方式">
                    <el-select v-model="form.downloadEditor.releases[platform.key].destinationKind">
                      <el-option label="上传安装包" value="direct" />
                      <el-option label="应用市场链接" value="market" />
                    </el-select>
                  </el-form-item>
                  <template v-if="form.downloadEditor.releases[platform.key].destinationKind === 'market'">
                    <el-form-item label="应用市场链接">
                      <el-input v-model="form.downloadEditor.releases[platform.key].url" placeholder="https://..." />
                    </el-form-item>
                  </template>
                  <template v-else>
                    <el-form-item v-if="form.key === 'say_ring_app_update'" label="上传安装包">
                      <input :accept="platform.key === 'android' ? '.apk' : '.hap'" type="file" :disabled="packageUploading[platform.key]" @change="uploadAppPackage(platform.key, $event)" />
                      <span v-if="packageUploading[platform.key]">正在上传并计算校验值…</span>
                    </el-form-item>
                    <el-form-item label="文件名">
                      <el-input v-model="form.downloadEditor.releases[platform.key].fileName" :placeholder="platform.packageLabel + ' 版本化文件名'" />
                    </el-form-item>
                    <el-form-item label="下载链接">
                      <el-input v-model="form.downloadEditor.releases[platform.key].url" placeholder="后台上传后自动填写，或使用 /global/down/files/文件名" />
                    </el-form-item>
                    <el-button class="download-url-button" plain @click="fillDownloadUrl(platform.key)">按文件名生成链接</el-button>
                    <el-form-item label="字节数">
                      <el-input-number v-model="form.downloadEditor.releases[platform.key].sizeBytes" :min="1" :step="1" controls-position="right" />
                    </el-form-item>
                    <el-form-item label="SHA-256">
                      <el-input v-model="form.downloadEditor.releases[platform.key].sha256" type="textarea" :rows="3" maxlength="64" show-word-limit />
                    </el-form-item>
                  </template>
                </template>
                <p v-else class="download-coming-note">待开放状态不会保存下载链接，前台按钮自动禁用。</p>
              </section>
            </div>
            <el-alert title="保存时需填写发布时间及三个平台的版本号、构建号；待开放平台不需要下载链接。Android/HarmonyOS 可使用同源安装包或 HTTPS 应用市场链接；iPhone 只允许官方 TestFlight 或 App Store 链接。" type="info" :closable="false" />
          </template>
          <template v-else-if="form.key === 'say_ring_map'">
            <el-alert title="仅 Say Ring 运动详情使用高德静态地图。请申请“Web 服务 API”类型的 Key；密钥加密保存，不会在 App 或后台回显。未填 Key 时运动轨迹仍可记录。" type="info" :closable="false" show-icon />
            <el-form-item label="启用地图"><el-switch v-model="form.value.enabled" /></el-form-item>
            <el-form-item label="Key 状态"
              ><el-tag :type="form.value?.configured ? 'success' : 'info'">{{ form.value?.configured ? "已保存" : "未配置" }}</el-tag></el-form-item
            >
            <el-form-item label="高德 Web 服务 Key"><el-input v-model="form.mapWebServiceKey" type="password" show-password autocomplete="new-password" placeholder="填入新 Key；留空保持原 Key" /></el-form-item>
          </template>
          <el-form-item v-else label="配置内容"><el-input v-model="form.valueText" type="textarea" :rows="12" /></el-form-item>
        </template>
        <template v-else-if="resource === 'admin-users'">
          <el-form-item label="账号" required><el-input v-model="form.username" :disabled="Boolean(form.id)" maxlength="50" placeholder="3至50位字母、数字、下划线、点或短横线" /></el-form-item>
          <el-form-item label="显示名称" required><el-input v-model="form.displayName" maxlength="50" /></el-form-item>
          <el-form-item v-if="!form.id" label="初始密码" required><el-input v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="至少12位" /></el-form-item>
          <el-form-item label="角色"
            ><el-select v-model="form.roles" multiple><el-option label="超级管理员" value="SUPER_ADMIN" /><el-option label="App 运营" value="APP_OPERATIONS" /><el-option label="商城运营" value="COMMERCE_OPERATIONS" /><el-option label="财务" value="FINANCE" /><el-option label="内容编辑" value="CONTENT_EDITOR" /><el-option label="客服" value="CUSTOMER_SERVICE" /><el-option label="健康数据审计员" value="HEALTH_AUDITOR" /><el-option label="集成管理员" value="INTEGRATION_ADMIN" /><el-option label="接口文档编辑" value="API_DOC_EDITOR" /><el-option label="只读" value="READ_ONLY" /></el-select
          ></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">关闭</el-button><el-button v-if="dialogMode === 'edit'" type="primary" :loading="saving" :disabled="(needsArticleCategories && !articleCategoriesReady) || (resource === 'commerce-products' && form._erpLookupPending)" @click="save">保存</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>
.member-referrer {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
}
.member-referrer > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.member-referrer b,
.member-referrer span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-referrer span {
  color: #667085;
  font-size: 12px;
}
.device-raw-payload {
  padding: 8px 24px;
}
.device-raw-payload pre {
  margin: 8px 0 0;
  padding: 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  background: #f5f7fa;
  border-radius: 4px;
}
.device-history-tabs { margin-top: 20px; }
.app-scope-tags { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
