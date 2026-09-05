<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, readableError, responseData } from "../api";
import {
  downloadEditorToManifest,
  downloadManifestToEditor,
  type DownloadManifestEditor,
} from "../download-setting";

type Row = Record<string, any>;
const route = useRoute();
const loading = ref(false);
const saving = ref(false);
const rows = ref<Row[]>([]);
const search = ref("");
const dialogVisible = ref(false);
const dialogTitle = ref("");
const dialogMode = ref<"edit" | "health">("edit");
const form = ref<Row>({});
const detailRows = ref<Row[]>([]);
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
  id: "编号", legacyMemberId: "旧会员编号", mobileMasked: "手机号", nickname: "昵称",
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
};
const resource = computed(() => String(route.params.resource || ""));
const title = computed(() => titles[resource.value] || resource.value);
const editable = computed(() => [
  "articles", "article-categories", "legal-documents", "settings", "integrations", "admin-users",
  "commerce-products", "commerce-categories", "commerce-orders", "commerce-after-sales",
  "commerce-banners", "commerce-business-configs", "commerce-reviews", "commerce-coupons",
  "health-report-offers", "notification-campaigns",
].includes(resource.value));
const createable = computed(() => [
  "articles", "article-categories", "legal-documents", "admin-users",
  "commerce-categories", "commerce-banners", "commerce-coupons", "health-report-offers", "notification-campaigns",
].includes(resource.value));
const searchable = computed(() => ["members", "commerce-products"].includes(resource.value));
const columns = computed(() => {
  const first = rows.value[0];
  return first ? Object.keys(first)
    .filter((key) => !["passwordHash", "secretRef", "contentHtml", "valueSnapshot", "ruleSnapshot"].includes(key))
    .slice(0, 10) : [];
});

async function load(): Promise<void> {
  if (resource.value === "commerce") return;
  loading.value = true;
  try {
    const response = await api.get(`/${resource.value}`, {
      params: searchable.value && search.value ? { search: search.value } : {},
    });
    const data = responseData<unknown>(response);
    rows.value = Array.isArray(data) ? data as Row[] : ((data as { items?: Row[] })?.items ?? []);
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally { loading.value = false; }
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function openCreate(): void {
  dialogMode.value = "edit";
  dialogTitle.value = `新增${title.value}`;
  const defaults: Record<string, Row> = {
    "admin-users": { role: "READ_ONLY", active: true },
    "commerce-products": { status: "DRAFT", gallery: [], tags: [], featured: false, sort: 0 },
    "commerce-categories": { enabled: true, sort: 0 },
    "commerce-banners": { enabled: true, sort: 0 },
    "commerce-coupons": { status: "DRAFT", value: 100, minimumSpendCents: 0, totalQuantity: 100 },
    "health-report-offers": { entitlement: "SINGLE_REPORT", creditCount: 1, platforms: ["android", "h5"], active: false },
    "notification-campaigns": { type: "SYSTEM", audienceAllActive: false, audienceUserIds: "" },
  };
  form.value = defaults[resource.value] ?? {};
  dialogVisible.value = true;
}

function openEdit(row: Row): void {
  dialogMode.value = "edit";
  dialogTitle.value = `编辑${title.value}`;
  const nextForm: Row = {
    ...row,
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
  if (row.key === "app_update") {
    try {
      nextForm.downloadEditor = downloadManifestToEditor(row.value);
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "App 下载配置无法读取");
      return;
    }
  }
  form.value = nextForm;
  dialogVisible.value = true;
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
      const settingValue = form.value.key === "app_update"
        ? downloadEditorToManifest(form.value.downloadEditor as DownloadManifestEditor)
        : JSON.parse(String(form.value.valueText || "{}"));
      payload = {
        value: settingValue,
        public: form.value.public !== false,
      };
      await api.patch(`/settings/${encodeURIComponent(String(form.value.key))}`, payload);
    } else if (resource.value === "commerce-business-configs") {
      payload = {
        label: form.value.label,
        value: JSON.parse(String(form.value.valueText || "{}")),
        enabled: form.value.enabled === true,
      };
      await api.patch(`/commerce-business-configs/${encodeURIComponent(String(form.value.key))}`, payload);
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
  if (release?.fileName) release.url = `/down/files/${release.fileName.trim()}`;
}

function payloadForResource(current: string, source: Row): Row {
  const fields: Record<string, string[]> = {
    "commerce-products": ["displayName", "subtitle", "brand", "categoryId", "coverImage", "detailHtml", "status", "featured", "sort", "localArchived"],
    "commerce-categories": ["name", "parentId", "iconUrl", "sort", "enabled"],
    "commerce-banners": ["title", "imageUrl", "targetUrl", "sort", "enabled"],
    "commerce-reviews": ["published"],
    "commerce-orders": ["adminRemark"],
    "commerce-after-sales": ["status", "returnLogisticsCompany", "returnTrackingNo"],
    "commerce-coupons": ["name", "status", "value", "minimumSpendCents", "totalQuantity", "validFrom", "validUntil", "employeeDistributable", "perEmployeeLimit"],
    "health-report-offers": ["offerKey", "title", "description", "entitlement", "priceCents", "currency", "creditCount", "durationDays", "platforms", "appleProductId", "active", "effectiveFrom", "effectiveUntil"],
    "notification-campaigns": ["name", "type", "title", "body", "deepLink", "scheduledAt"],
  };
  if (current === "commerce-products") {
    return {
      ...pick(source, fields["commerce-products"]!),
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
  try {
    const suffix = raw ? "health-records" : "health-summary";
    const data = responseData<unknown>(await api.get(`/members/${encodeURIComponent(String(row.id))}/${suffix}`, {
      params: raw ? { reason } : {},
    }));
    detailRows.value = Array.isArray(data) ? data as Row[] : [];
    dialogMode.value = "health";
    dialogTitle.value = raw ? "原始健康记录（已审计）" : "健康数据摘要";
    dialogVisible.value = true;
  } catch (error) { ElMessage.error(readableError(error)); }
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

async function refundAfterSale(row: Row): Promise<void> {
  try {
    const response = await ElMessageBox.prompt(
      `将按售后申请金额 ${Number(row.requestedCents ?? 0) / 100} 元原路退款。支付渠道受理不等于退款成功，最终以验签回调为准。`,
      "发起退款",
      {
        type: "warning",
        inputValue: String(row.reason ?? "售后退款"),
        inputValidator: (value) => value.trim().length >= 2 || "请填写退款原因",
        confirmButtonText: "确认发起",
      },
    );
    await api.post(`/commerce-after-sales/${row.id}/refund`, { reason: response.value.trim() });
    ElMessage.success("退款请求已提交，请等待渠道结果");
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(readableError(error));
  }
}

onMounted(load);
</script>

<template>
  <section class="page">
    <h1 class="page-title">{{ title }}</h1>
    <div class="resource-content">
      <div class="toolbar">
        <el-input v-if="searchable" v-model="search" :placeholder="resource === 'members' ? '昵称、旧会员编号或手机号' : '商品名或ERP编号'" clearable style="width: 300px" @keyup.enter="load" />
        <el-button type="primary" @click="load">刷新</el-button>
        <el-button v-if="createable" @click="openCreate">新增</el-button>
        <el-button v-if="resource === 'commerce-jobs'" @click="runAction('/commerce-jobs/product-sync', '已安排同步最近24小时商品')">同步商品</el-button>
        <el-button v-if="resource === 'commerce-jobs'" @click="runAction('/commerce-jobs/fulfillment-sync', '已安排物流同步')">同步物流</el-button>
        <span class="muted">敏感字段已在服务端脱敏；无权限时不会返回原始健康数据。</span>
      </div>
      <el-table v-loading="loading" :data="rows" border stripe empty-text="暂无记录">
        <el-table-column v-for="column in columns" :key="column" :prop="column" :label="fieldLabels[column] || column" min-width="145" show-overflow-tooltip>
          <template #default="scope">{{ render(scope.row[column]) }}</template>
        </el-table-column>
        <el-table-column v-if="resource === 'members'" label="健康数据" width="230" fixed="right">
          <template #default="scope">
            <el-button size="small" @click="viewHealth(scope.row, false)">查看摘要</el-button>
            <el-button size="small" type="warning" plain @click="viewHealth(scope.row, true)">原始记录</el-button>
          </template>
        </el-table-column>
        <el-table-column v-if="resource === 'feedback'" label="处理" width="170" fixed="right">
          <template #default="scope">
            <el-select :model-value="scope.row.status" size="small" @change="(value: string) => updateFeedback(scope.row, value)">
              <el-option label="待处理" value="OPEN" /><el-option label="处理中" value="IN_PROGRESS" />
              <el-option label="已解决" value="RESOLVED" /><el-option label="已关闭" value="CLOSED" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column v-if="editable || ['commerce-jobs', 'health-reports'].includes(resource)" label="操作" min-width="110" fixed="right">
          <template #default="scope">
            <el-button v-if="editable" size="small" @click="openEdit(scope.row)">编辑</el-button>
            <el-button v-if="resource === 'commerce-jobs' && ['FAILED', 'DEAD_LETTER'].includes(scope.row.status)" size="small" type="warning" @click="runAction(`/commerce-jobs/${scope.row.id}/retry`, '任务已重新排队')">重试</el-button>
            <el-button v-if="resource === 'health-reports' && scope.row.status === 'FAILED'" size="small" type="warning" @click="runAction(`/health-reports/${scope.row.id}/retry`, '报告已重新排队')">重试</el-button>
            <el-button v-if="resource === 'notification-campaigns' && scope.row.status === 'DRAFT'" size="small" type="primary" @click="runAction(`/notification-campaigns/${scope.row.id}/schedule`, '通知已安排发送')">安排发送</el-button>
            <el-button v-if="resource === 'commerce-after-sales' && ['APPROVED', 'RETURNED'].includes(scope.row.status)" size="small" type="danger" @click="refundAfterSale(scope.row)">发起退款</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" :width="resource === 'settings' && form.key === 'app_update' ? '980px' : '720px'" destroy-on-close>
      <el-table v-if="dialogMode === 'health'" :data="detailRows" border max-height="520" empty-text="暂无记录">
        <el-table-column v-for="column in Object.keys(detailRows[0] || {}).slice(0, 9)" :key="column" :label="fieldLabels[column] || column" min-width="145">
          <template #default="scope">{{ render(scope.row[column]) }}</template>
        </el-table-column>
      </el-table>
      <el-form v-else label-width="110px">
        <template v-if="resource === 'articles'">
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="摘要"><el-input v-model="form.summary" type="textarea" /></el-form-item>
          <el-form-item label="分类编号"><el-input v-model="form.categoryId" /></el-form-item>
          <el-form-item label="封面地址"><el-input v-model="form.coverUrl" /></el-form-item>
          <el-form-item label="正文"><el-input v-model="form.contentHtml" type="textarea" :rows="10" /></el-form-item>
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
          <el-alert title="商品展示资料在这里维护；SKU、库存和履约数据以聚水潭真实同步结果为准。" type="info" :closable="false" show-icon />
          <el-form-item label="ERP商品编号"><el-input v-model="form.erpItemId" disabled /></el-form-item>
          <el-form-item label="ERP商品名称"><el-input v-model="form.name" disabled /></el-form-item>
          <el-form-item label="展示名称"><el-input v-model="form.displayName" /></el-form-item>
          <el-form-item label="副标题"><el-input v-model="form.subtitle" /></el-form-item>
          <el-form-item label="品牌"><el-input v-model="form.brand" /></el-form-item>
          <el-form-item label="分类编号"><el-input v-model="form.categoryId" /></el-form-item>
          <el-form-item label="封面地址"><el-input v-model="form.coverImage" /></el-form-item>
          <el-form-item label="相册地址"><el-input v-model="form.galleryText" type="textarea" :rows="4" placeholder="每行一个图片地址" /></el-form-item>
          <el-form-item label="标签"><el-input v-model="form.tagsText" placeholder="多个标签用逗号分隔" /></el-form-item>
          <el-form-item label="商品详情"><el-input v-model="form.detailHtml" type="textarea" :rows="8" /></el-form-item>
          <el-form-item label="状态"><el-select v-model="form.status"><el-option label="草稿" value="DRAFT" /><el-option label="在售" value="PUBLISHED" /><el-option label="下架" value="OFF_SHELF" /></el-select></el-form-item>
          <el-form-item label="首页推荐"><el-switch v-model="form.featured" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" /></el-form-item>
        </template>
        <template v-else-if="resource === 'commerce-categories'">
          <el-form-item label="分类名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="上级编号"><el-input v-model="form.parentId" clearable /></el-form-item>
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
          <el-form-item label="配置项"><el-input v-model="form.key" disabled /></el-form-item>
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
          <el-form-item label="处理状态"><el-select v-model="form.status"><el-option label="审核中" value="REVIEWING" /><el-option label="通过" value="APPROVED" /><el-option label="拒绝" value="REJECTED" /><el-option label="等待退货" value="WAITING_RETURN" /><el-option label="已退回" value="RETURNED" /><el-option label="已取消" value="CANCELLED" /></el-select></el-form-item>
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
          <el-form-item label="设置项"><el-input v-model="form.key" disabled /></el-form-item>
          <el-form-item label="公开"><el-switch v-model="form.public" /></el-form-item>
          <template v-if="form.key === 'app_update' && form.downloadEditor">
            <el-alert title="保存后下载页会读取新配置。此处不上传安装包；Android/HarmonyOS 文件需先放入服务器 /down/files/ 目录。" type="warning" :closable="false" show-icon />
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
                    <el-input v-model="form.downloadEditor.releases[platform.key].url" placeholder="/down/files/文件名" />
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
            <el-alert title="Android/HarmonyOS 只允许 /down/files/ 同源地址；iPhone 只允许官方 TestFlight 或 App Store HTTPS 链接。" type="info" :closable="false" />
          </template>
          <el-form-item v-else label="配置内容"><el-input v-model="form.valueText" type="textarea" :rows="12" /></el-form-item>
        </template>
        <template v-else-if="resource === 'admin-users'">
          <el-form-item label="账号"><el-input v-model="form.username" :disabled="Boolean(form.id)" /></el-form-item>
          <el-form-item label="显示名称"><el-input v-model="form.displayName" /></el-form-item>
          <el-form-item v-if="!form.id" label="初始密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
          <el-form-item label="角色"><el-select v-model="form.role"><el-option label="超级管理员" value="SUPER_ADMIN" /><el-option label="App 运营" value="APP_OPERATIONS" /><el-option label="商城运营" value="COMMERCE_OPERATIONS" /><el-option label="财务" value="FINANCE" /><el-option label="内容编辑" value="CONTENT_EDITOR" /><el-option label="客服" value="CUSTOMER_SERVICE" /><el-option label="健康数据审计员" value="HEALTH_AUDITOR" /><el-option label="集成管理员" value="INTEGRATION_ADMIN" /><el-option label="接口文档编辑" value="API_DOC_EDITOR" /><el-option label="只读" value="READ_ONLY" /></el-select></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
        </template>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">关闭</el-button><el-button v-if="dialogMode === 'edit'" type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </section>
</template>
