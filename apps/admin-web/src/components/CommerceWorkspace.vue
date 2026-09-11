<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { canAdminResource } from "@saydian/app-contracts";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, getAdminRoles, readableError, responseData } from "../api";
import AfterSaleEvidence from "./AfterSaleEvidence.vue";
import ProductSkuQuickEditor from "./ProductSkuQuickEditor.vue";

type Row = Record<string, any>;
type TagType = "primary" | "success" | "warning" | "info" | "danger";

const props = defineProps<{
  resource: string;
  rows: Row[];
  meta: Row;
  loading: boolean;
  createable: boolean;
  search: string;
}>();

const emit = defineEmits<{
  "update:search": [value: string];
  refresh: [];
  create: [];
  edit: [row: Row];
  refund: [row: Row];
  ship: [row: Row];
  "shipping-refund": [row: Row];
  "page-change": [page: number];
  "status-change": [status: string];
  "run-action": [path: string, success: string];
  "batch-products": [ids: string[], action: string];
}>();

const statusFilter = ref("");
const detailVisible = ref(false);
const detailRow = ref<Row>({});
const manualOrderVisible = ref(false);
const manualOrderSaving = ref(false);
const manualOrderForm = ref({
  action: "ADJUST_PRICE",
  payableYuan: 0,
  note: "",
  orderVersion: 0,
  idempotencyKey: "",
});
const commissionTab = ref<"accruals" | "ledger">("accruals");
const selectedProductIds = ref<string[]>([]);
const canEdit = computed(() => canAdminResource(getAdminRoles(), props.resource, "write"));
const canRefund = computed(() => canAdminResource(getAdminRoles(), props.resource, "refund"));
const canManuallySettleOrder = computed(() => getAdminRoles().includes("SUPER_ADMIN"));

watch(() => props.resource, () => {
  statusFilter.value = "";
  detailVisible.value = false;
  manualOrderVisible.value = false;
  commissionTab.value = "accruals";
  selectedProductIds.value = [];
});

const descriptions: Record<string, string> = {
  "commerce-products": "管理本地商品与ERP同步商品。详情中可快速调整售价和库存；ERP商品再次同步时可能覆盖手工值。",
  "commerce-categories": "按层级维护商城分类、图标、排序和启用状态；分类停用后不会出现在商城分类入口。",
  "commerce-banners": "管理商城首页轮播图片、跳转目标、排序和启用状态，图片与目标地址均由商城前端读取。",
  "commerce-business-configs": "集中维护购物、配送、发票等业务参数；支付密钥和外部平台凭据仍在集成中心配置。",
  "commerce-orders": "按订单状态查看商品、金额、买家、收货和履约信息；超级管理员可在待付款订单详情中调价或登记线下收款，其他状态仍由支付、物流与售后流程推进。",
  "commerce-after-sales": "商品售后与单独退运费均需审核；现金以验签渠道结果为准，纯积分商品审核后本地结算。",
  "commerce-reviews": "查看真实订单评价、评分和图片，后台只控制评价是否在商城公开展示。",
  "commerce-coupons": "管理优惠金额、使用门槛、发行数量、有效期和员工分发范围。",
  "commerce-employees": "查看企业微信员工、推广码、部门和钱包摘要；企业微信身份与授权状态以真实联调为准。",
  "commerce-commissions": "查看奖金规则、计提与钱包流水。规则调整只影响新计提；提现审核请进入“提现审核”。",
  "commerce-jobs": "查看聚水潭商品与履约同步任务，失败任务可在确认后重新排队。",
  payments: "查看商城与健康业务共用的支付流水；渠道受理、支付成功和退款完成是不同状态。",
};

const filterOptions = computed(() => {
  const options: Record<string, Array<[string, string]>> = {
    "commerce-products": [["PUBLISHED", "出售中"], ["DRAFT", "草稿"], ["OFF_SHELF", "已下架"], ["OUT_OF_STOCK", "无库存"], ["ARCHIVED", "已归档"]],
    "commerce-categories": [["ENABLED", "已启用"], ["DISABLED", "已停用"]],
    "commerce-banners": [["ENABLED", "已启用"], ["DISABLED", "已停用"]],
    "commerce-business-configs": [["ENABLED", "已启用"], ["DISABLED", "已停用"]],
    "commerce-orders": [["PENDING_PAYMENT", "待付款"], ["PAID", "已支付"], ["WAITING_FULFILLMENT", "待发货"], ["SHIPPED", "已发货"], ["RECEIVED", "已收货"], ["COMPLETED", "已完成"], ["CANCELLED", "已取消"], ["AFTER_SALE", "售后中"], ["REFUNDED", "已退款"]],
    "commerce-after-sales": [["APPLIED", "已申请"], ["REVIEWING", "审核中"], ["APPROVED", "已通过"], ["WAITING_RETURN", "等待退货"], ["RETURNED", "已退回"], ["REFUNDING", "退款中"], ["COMPLETED", "已完成"], ["REJECTED", "已拒绝"]],
    "commerce-reviews": [["PUBLISHED", "前台展示"], ["HIDDEN", "已隐藏"], ["GOOD", "好评"], ["MEDIUM", "中评"], ["BAD", "差评"]],
    "commerce-coupons": [["ACTIVE", "启用"], ["DRAFT", "草稿"], ["PAUSED", "暂停"], ["EXPIRED", "已过期"]],
    "commerce-employees": [["ACTIVE", "在职启用"], ["INACTIVE", "已停用"]],
    "commerce-jobs": [["PENDING", "等待执行"], ["RUNNING", "执行中"], ["SUCCEEDED", "成功"], ["FAILED", "失败"], ["DEAD_LETTER", "已终止"]],
    payments: [["CREATED", "已创建"], ["PENDING", "处理中"], ["SUCCEEDED", "成功"], ["FAILED", "失败"], ["REFUNDING", "退款中"], ["REFUNDED", "已退款"], ["CLOSED", "已关闭"]],
  };
  return options[props.resource] ?? [];
});

const filterPlaceholder = computed(() => ({
  "commerce-products": "商品名、ERP编号、品牌",
  "commerce-categories": "分类名称、上级分类",
  "commerce-banners": "轮播标题、跳转地址",
  "commerce-business-configs": "配置项、名称",
  "commerce-orders": "订单号、买家、收货人",
  "commerce-after-sales": "售后单号、订单号、原因",
  "commerce-reviews": "商品、评价人、评价内容",
  "commerce-coupons": "优惠券名称",
  "commerce-employees": "员工、手机号、部门、推广码",
  "commerce-commissions": "员工、订单、流水说明",
  "commerce-jobs": "任务类型、业务编号、失败原因",
  payments: "支付单号、业务编号、渠道",
}[props.resource] ?? "搜索当前列表"));

const sourceRows = computed<Row[]>(() => {
  if (props.resource === "commerce-commissions" && commissionTab.value === "ledger") {
    return Array.isArray(props.meta.ledger) ? props.meta.ledger : [];
  }
  return props.rows;
});

const visibleRows = computed(() => {
  const keyword = props.search.trim().toLowerCase();
  return sourceRows.value.filter((row) => {
    if (statusFilter.value && !matchesStatus(row, statusFilter.value)) return false;
    if (!keyword) return true;
    return ["commerce-orders", "commerce-products"].includes(props.resource) || JSON.stringify(row).toLowerCase().includes(keyword);
  });
});

const metrics = computed(() => {
  const rows = props.rows;
  switch (props.resource) {
    case "commerce-products":
      return [
        ["商品总数", props.meta.total ?? rows.length],
        ["本页出售中", rows.filter((row) => row.status === "PUBLISHED" && !row.localArchived).length],
        ["本页无库存", rows.filter((row) => stockTotal(row) <= 0).length],
        ["本页销量", rows.reduce((sum, row) => sum + Number(row.sales ?? 0), 0)],
      ];
    case "commerce-categories":
      return [["分类总数", rows.length], ["已启用", rows.filter((row) => row.enabled).length], ["一级分类", rows.filter((row) => !row.parentId).length], ["二级分类", rows.filter((row) => row.parentId).length]];
    case "commerce-banners":
      return [["轮播总数", rows.length], ["已启用", rows.filter((row) => row.enabled).length], ["已停用", rows.filter((row) => !row.enabled).length], ["已配置跳转", rows.filter((row) => row.targetUrl).length]];
    case "commerce-business-configs":
      return [["配置总数", rows.length], ["已启用", rows.filter((row) => row.enabled).length], ["购物与订单", rows.filter((row) => /^(order|shopping|review|afterSale)\./.test(String(row.key))).length], ["配送与发票", rows.filter((row) => /^(shipping|invoice)\./.test(String(row.key))).length]];
    case "commerce-orders":
      return [["筛选订单总数", props.meta.total ?? rows.length], ["筛选待付款", props.meta.stats?.statusCounts?.PENDING_PAYMENT ?? 0], ["筛选待发货", (props.meta.stats?.statusCounts?.PAID ?? 0) + (props.meta.stats?.statusCounts?.WAITING_FULFILLMENT ?? 0)], ["筛选已付订单金额", money(props.meta.stats?.paidOrderCents ?? 0)]];
    case "commerce-after-sales":
      return [["售后总数", rows.length], ["待处理", rows.filter((row) => ["APPLIED", "REVIEWING"].includes(row.status)).length], ["退款处理中", rows.filter((row) => row.status === "REFUNDING").length], ["已完成", rows.filter((row) => row.status === "COMPLETED").length]];
    case "commerce-reviews": {
      const average = rows.length ? (rows.reduce((sum, row) => sum + Number(row.rating ?? 0), 0) / rows.length).toFixed(1) : "—";
      return [["评价总数", rows.length], ["平均评分", average], ["前台展示", rows.filter((row) => row.published).length], ["待复核低分", rows.filter((row) => Number(row.rating ?? 0) <= 2).length]];
    }
    case "commerce-coupons":
      return [["优惠券总数", rows.length], ["当前启用", rows.filter((row) => row.status === "ACTIVE").length], ["累计领取", rows.reduce((sum, row) => sum + Number(row.claimedQuantity ?? row._count?.claims ?? 0), 0)], ["员工可分发", rows.filter((row) => row.employeeDistributable).length]];
    case "commerce-employees":
      return [["员工总数", rows.length], ["启用员工", rows.filter((row) => row.active).length], ["可用奖金", money(rows.reduce((sum, row) => sum + Number(row.wallet?.availableCents ?? 0), 0))], ["冻结奖金", money(rows.reduce((sum, row) => sum + Number(row.wallet?.frozenCents ?? 0), 0))]];
    case "commerce-commissions":
      return [["奖金规则", props.meta.plan?.enabled ? "已启用" : "未启用"], ["奖金比例", props.meta.plan ? `${(Number(props.meta.plan.rateBps ?? 0) / 100).toFixed(2)}%` : "—"], ["计提记录", rows.length], ["累计奖金", money(rows.reduce((sum, row) => sum + Number(row.grossBonusCents ?? 0) - Number(row.reversedBonusCents ?? 0), 0))]];
    case "commerce-jobs":
      return [["任务总数", rows.length], ["等待/执行中", rows.filter((row) => ["PENDING", "RUNNING"].includes(row.status)).length], ["执行成功", rows.filter((row) => row.status === "SUCCEEDED").length], ["失败/终止", rows.filter((row) => ["FAILED", "DEAD_LETTER"].includes(row.status)).length]];
    case "payments":
      return [["本页流水", rows.length], ["支付成功", rows.filter((row) => row.status === "SUCCEEDED").length], ["退款处理中", rows.filter((row) => row.status === "REFUNDING").length], ["成功金额", money(rows.filter((row) => row.status === "SUCCEEDED").reduce((sum, row) => sum + Number(row.amountCents ?? 0), 0))]];
    default:
      return [];
  }
});

function matchesStatus(row: Row, filter: string): boolean {
  if (filter === "OUT_OF_STOCK") return stockTotal(row) <= 0;
  if (filter === "ARCHIVED") return row.localArchived === true;
  if (filter === "ENABLED") return row.enabled === true;
  if (filter === "DISABLED") return row.enabled === false;
  if (filter === "PUBLISHED" && props.resource === "commerce-reviews") return row.published === true;
  if (filter === "HIDDEN") return row.published === false;
  if (filter === "ACTIVE" && props.resource === "commerce-employees") return row.active === true;
  if (filter === "INACTIVE") return row.active === false;
  if (filter === "GOOD") return Number(row.rating ?? 0) >= 4;
  if (filter === "MEDIUM") return Number(row.rating ?? 0) === 3;
  if (filter === "BAD") return Number(row.rating ?? 0) <= 2;
  return row.status === filter;
}

function money(cents: unknown, currency = "CNY"): string {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount / 100);
}

function dateTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function stockTotal(row: Row): number {
  return Array.isArray(row.skus) ? row.skus.reduce((sum: number, sku: Row) => sum + Number(sku.stock ?? 0), 0) : 0;
}

function skuCount(row: Row): number {
  return Array.isArray(row.skus) ? row.skus.length : 0;
}

function priceRange(row: Row): string {
  const prices = Array.isArray(row.skus)
    ? row.skus.map((sku: Row) => Number(sku.salePriceCents)).filter(Number.isFinite)
    : [];
  if (!prices.length) return "—";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? money(min) : `${money(min)} - ${money(max)}`;
}

function statusLabel(status: unknown): string {
  const labels: Record<string, string> = {
    DRAFT: "草稿", PUBLISHED: "出售中", OFF_SHELF: "已下架",
    PENDING_PAYMENT: "待付款", PAID: "已支付", WAITING_FULFILLMENT: "待发货", SHIPPED: "已发货", RECEIVED: "已收货", COMPLETED: "已完成", CANCELLED: "已取消", CLOSED: "已关闭", AFTER_SALE: "售后中", REFUNDED: "已退款",
    APPLIED: "已申请", REVIEWING: "审核中", APPROVED: "已通过", REJECTED: "已拒绝", WAITING_RETURN: "等待退货", RETURNED: "已退回", REFUNDING: "退款中",
    ACTIVE: "启用", PAUSED: "暂停", EXPIRED: "已过期",
    PENDING: "等待执行", RUNNING: "执行中", SUCCEEDED: "成功", FAILED: "失败", DEAD_LETTER: "已终止", CREATED: "已创建", PARTIAL_REFUNDED: "部分退款",
  };
  return labels[String(status)] ?? String(status ?? "—");
}

function statusType(status: unknown): TagType {
  const value = String(status ?? "");
  if (["PUBLISHED", "ACTIVE", "SUCCEEDED", "COMPLETED", "RECEIVED"].includes(value)) return "success";
  if (["FAILED", "DEAD_LETTER", "REJECTED"].includes(value)) return "danger";
  if (["PENDING", "PENDING_PAYMENT", "WAITING_FULFILLMENT", "REVIEWING", "REFUNDING", "WAITING_RETURN"].includes(value)) return "warning";
  return "info";
}

function productName(row: Row): string {
  return String(row.displayName || row.name || "未命名商品");
}

function orderItemsSummary(row: Row): string {
  if (!Array.isArray(row.items) || !row.items.length) return "暂无商品明细";
  const first = row.items[0];
  const more = row.items.length > 1 ? ` 等 ${row.items.length} 种商品` : "";
  return `${first.nameSnapshot || "商品"} × ${first.quantity ?? 1}${more}`;
}

function storefrontProductUrl(productId: unknown): string {
  const id = String(productId ?? "").trim();
  return id ? `/global/saidian-mall/#/pages/product/index?id=${encodeURIComponent(id)}` : "";
}

function categoryName(row: Row): string {
  return String(row.category?.name || "未分类");
}

function openDetail(row: Row): void {
  detailRow.value = row;
  detailVisible.value = true;
}

function paymentChannelLabel(channel: unknown): string {
  const labels: Record<string, string> = {
    OFFLINE_MANUAL: "线下收款", WECHAT_MINI: "微信小程序", WECHAT_JSAPI: "微信公众号",
    WECHAT_H5: "微信 H5", WECHAT_NATIVE: "微信扫码", WECHAT_APP: "微信 App",
    ALIPAY_WAP: "支付宝手机网页", ALIPAY_PAGE: "支付宝电脑网页", ALIPAY_APP: "支付宝 App", APPLE_IAP: "Apple 内购",
  };
  return labels[String(channel)] ?? String(channel ?? "—");
}

function hasActiveOnlinePayment(row: Row): boolean {
  return Array.isArray(row.paymentIntents)
    && row.paymentIntents.some((intent: Row) => ["CREATED", "PENDING"].includes(String(intent.status)));
}

function openManualOrder(row: Row): void {
  if (!canManuallySettleOrder.value || row.status !== "PENDING_PAYMENT" || row.paidAt || row.executionOwner !== "NEW_SYSTEM" || hasActiveOnlinePayment(row)) return;
  manualOrderForm.value = {
    action: "ADJUST_PRICE",
    payableYuan: Number(row.payableCents ?? 0) / 100,
    note: "",
    orderVersion: Number(row.version ?? 0),
    idempotencyKey: crypto.randomUUID(),
  };
  manualOrderVisible.value = true;
}

async function saveManualOrder(): Promise<void> {
  if (manualOrderSaving.value) return;
  const yuan = Number(manualOrderForm.value.payableYuan);
  const payableCents = Math.round(yuan * 100);
  const note = manualOrderForm.value.note.trim();
  if (!Number.isFinite(yuan) || payableCents < 1) { ElMessage.error("请填写有效的订单应付金额"); return; }
  if (note.length < 2 || note.length > 500) { ElMessage.error("请填写2至500字的处理备注"); return; }
  const paid = manualOrderForm.value.action === "CONFIRM_OFFLINE_PAID";
  manualOrderSaving.value = true;
  try {
    await ElMessageBox.confirm(
      paid
        ? `确认已在线下实际收到 ${money(payableCents, detailRow.value.currency)}？保存后订单将进入已支付状态，不能在此撤回。`
        : `确认将订单应付金额调整为 ${money(payableCents, detailRow.value.currency)}？`,
      paid ? "确认线下收款" : "确认订单调价",
      { type: "warning", confirmButtonText: paid ? "确认已收款" : "确认调价", cancelButtonText: "取消" },
    );
    const saved = responseData<Row>(await api.post(`/commerce-orders/${encodeURIComponent(String(detailRow.value.id))}/manual-payment`, {
      action: manualOrderForm.value.action,
      payableCents,
      note,
      orderVersion: manualOrderForm.value.orderVersion,
      idempotencyKey: manualOrderForm.value.idempotencyKey,
    }));
    detailRow.value = { ...detailRow.value, ...saved };
    manualOrderVisible.value = false;
    ElMessage.success(paid ? "线下收款已登记，订单已标记为已支付" : "订单应付金额已更新");
    emit("refresh");
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(readableError(error));
  } finally {
    manualOrderSaving.value = false;
  }
}

function productSkusSaved(product: Row): void {
  detailRow.value = product;
  emit("refresh");
}

function jsonText(value: unknown): string {
  return value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);
}

function changeStatus(value: unknown): void {
  statusFilter.value = String(value ?? "");
  emit("status-change", statusFilter.value);
}
</script>

<template>
  <div class="commerce-workspace">
    <el-alert :title="descriptions[resource]" type="info" :closable="false" show-icon />

    <div class="metric-grid">
      <article v-for="metric in metrics" :key="String(metric[0])" class="metric-card">
        <span>{{ metric[0] }}</span>
        <strong>{{ metric[1] }}</strong>
      </article>
    </div>

    <div class="commerce-toolbar">
      <el-input :model-value="search" :placeholder="filterPlaceholder" clearable class="search-input" @update:model-value="emit('update:search', String($event))" @keyup.enter="emit('refresh')" />
      <el-select v-if="filterOptions.length" :model-value="statusFilter" clearable placeholder="全部状态" class="status-select" @change="changeStatus">
        <el-option v-for="option in filterOptions" :key="option[0]" :label="option[1]" :value="option[0]" />
      </el-select>
      <el-button type="primary" @click="emit('refresh')">刷新</el-button>
      <el-button v-if="createable" @click="emit('create')">新增</el-button>
      <el-button v-if="canEdit && resource === 'commerce-commissions'" @click="emit('edit', { enabled: false, rateBps: 0, settlementDays: 7, withdrawalEnabled: false, minimumWithdrawCents: null, dailyWithdrawLimitCents: null, ...meta.plan, reviewRequired: true })">奖金与提现规则</el-button>
      <template v-if="canEdit && resource === 'commerce-products' && selectedProductIds.length">
        <el-button @click="emit('batch-products', selectedProductIds, 'PUBLISH')">批量上架</el-button>
        <el-button @click="emit('batch-products', selectedProductIds, 'DISABLE')">批量下架</el-button>
        <el-button type="danger" plain @click="emit('batch-products', selectedProductIds, 'ARCHIVE')">批量归档</el-button>
      </template>
      <template v-if="canEdit && resource === 'commerce-jobs'">
        <el-button @click="emit('run-action', '/commerce-jobs/product-sync', '已安排同步最近24小时商品')">同步商品</el-button>
        <el-button @click="emit('run-action', '/commerce-jobs/fulfillment-sync', '已安排物流同步')">同步物流</el-button>
      </template>
      <span class="result-count">当前显示 {{ visibleRows.length }} 条</span>
    </div>

    <el-table v-if="resource === 'commerce-products'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无商品，可新增本地商品或从ERP同步" @selection-change="(items: Row[]) => selectedProductIds = items.map((item) => item.id)">
      <el-table-column type="selection" width="45" />
      <el-table-column label="来源" width="85"><template #default="scope"><el-tag size="small">{{ scope.row.source === 'LOCAL' ? '本地' : 'ERP' }}</el-tag></template></el-table-column>
      <el-table-column label="主图" width="92">
        <template #default="scope"><el-image v-if="scope.row.coverImage" :src="scope.row.coverImage" fit="cover" class="thumb"><template #error><div class="image-fallback">无图</div></template></el-image><div v-else class="image-fallback">无图</div></template>
      </el-table-column>
      <el-table-column label="商品信息" min-width="260">
        <template #default="scope"><strong>{{ productName(scope.row) }}</strong><small>{{ scope.row.subtitle || `${scope.row.source === 'LOCAL' ? '本地编号' : 'ERP'}：${scope.row.erpItemId || '—'}` }}</small><div class="tag-row"><el-tag v-if="scope.row.featured" size="small" type="warning">推荐</el-tag><el-tag v-for="tag in (scope.row.tags || []).slice(0, 3)" :key="tag" size="small" type="info">{{ tag }}</el-tag></div></template>
      </el-table-column>
      <el-table-column label="分类" min-width="130"><template #default="scope">{{ categoryName(scope.row) }}</template></el-table-column>
      <el-table-column label="销售价" min-width="155"><template #default="scope">{{ priceRange(scope.row) }}</template></el-table-column>
      <el-table-column prop="sales" label="销量" width="90" />
      <el-table-column label="库存 / SKU" width="130"><template #default="scope"><strong :class="{ 'danger-text': stockTotal(scope.row) <= 0 }">{{ stockTotal(scope.row) }}</strong><small>{{ skuCount(scope.row) }} 个 SKU</small></template></el-table-column>
      <el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ scope.row.localArchived ? "已归档" : statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column label="操作" width="150" fixed="right"><template #default="scope"><el-button size="small" @click="openDetail(scope.row)">查看</el-button><el-button v-if="canEdit" size="small" type="primary" plain @click="emit('edit', scope.row)">编辑</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-categories'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无分类">
      <el-table-column label="图标" width="92"><template #default="scope"><el-image v-if="scope.row.iconUrl" :src="scope.row.iconUrl" fit="cover" class="category-icon"><template #error><div class="image-fallback">无图</div></template></el-image><div v-else class="image-fallback">无图</div></template></el-table-column>
      <el-table-column label="分类名称" min-width="220"><template #default="scope"><strong>{{ scope.row.name }}</strong><small>{{ scope.row.parent?.name ? `上级：${scope.row.parent.name}` : "一级分类" }}</small></template></el-table-column>
      <el-table-column label="分类编号" min-width="250"><template #default="scope"><code>{{ scope.row.id }}</code></template></el-table-column>
      <el-table-column prop="sort" label="排序" width="100" />
      <el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? "启用" : "停用" }}</el-tag></template></el-table-column>
      <el-table-column label="更新时间" width="175"><template #default="scope">{{ dateTime(scope.row.updatedAt) }}</template></el-table-column>
      <el-table-column label="操作" width="95" fixed="right"><template #default="scope"><el-button v-if="canEdit" size="small" type="primary" plain @click="emit('edit', scope.row)">编辑</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-banners'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无首页轮播">
      <el-table-column label="预览" width="190"><template #default="scope"><el-image v-if="scope.row.imageUrl" :src="scope.row.imageUrl" fit="cover" class="banner-thumb"><template #error><div class="banner-fallback">图片无法加载</div></template></el-image><div v-else class="banner-fallback">未配置图片</div></template></el-table-column>
      <el-table-column prop="title" label="标题" min-width="200" />
      <el-table-column label="跳转目标" min-width="270"><template #default="scope"><code>{{ scope.row.targetUrl || "不跳转" }}</code></template></el-table-column>
      <el-table-column prop="sort" label="排序" width="90" />
      <el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? "启用" : "停用" }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="95" fixed="right"><template #default="scope"><el-button v-if="canEdit" size="small" type="primary" plain @click="emit('edit', scope.row)">编辑</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-business-configs'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无商城参数；可新增购物、配送或发票配置">
      <el-table-column prop="label" label="配置名称" min-width="190" />
      <el-table-column label="配置项" min-width="220"><template #default="scope"><code>{{ scope.row.key }}</code></template></el-table-column>
      <el-table-column label="配置内容" min-width="360"><template #default="scope"><pre class="json-preview">{{ jsonText(scope.row.value) }}</pre></template></el-table-column>
      <el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? "启用" : "停用" }}</el-tag></template></el-table-column>
      <el-table-column label="更新时间" width="175"><template #default="scope">{{ dateTime(scope.row.updatedAt) }}</template></el-table-column>
      <el-table-column label="操作" width="95" fixed="right"><template #default="scope"><el-button v-if="canEdit" size="small" type="primary" plain @click="emit('edit', scope.row)">编辑</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-orders'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无订单">
      <el-table-column label="订单信息" min-width="220"><template #default="scope"><strong>{{ scope.row.orderNo }}</strong><small>{{ dateTime(scope.row.createdAt) }}</small></template></el-table-column>
      <el-table-column label="商品清单" min-width="240"><template #default="scope"><a v-if="storefrontProductUrl(scope.row.items?.[0]?.productId)" class="product-link" :href="storefrontProductUrl(scope.row.items[0].productId)" target="_blank" rel="noopener noreferrer">{{ orderItemsSummary(scope.row) }}</a><template v-else>{{ orderItemsSummary(scope.row) }}</template></template></el-table-column>
      <el-table-column label="金额" width="145"><template #default="scope"><strong>{{ money(scope.row.payableCents, scope.row.currency) }}</strong><small>运费 {{ money(scope.row.shippingCents, scope.row.currency) }}</small></template></el-table-column>
      <el-table-column label="收货信息" min-width="190"><template #default="scope"><strong>{{ scope.row.recipientName }}</strong><small>{{ scope.row.recipientMobile }}</small><small>{{ scope.row.province }} {{ scope.row.city }} {{ scope.row.district }}</small></template></el-table-column>
      <el-table-column label="买家" min-width="135"><template #default="scope">{{ scope.row.user?.nickname || "未命名会员" }}<small>{{ scope.row.user?.mobile }}</small></template></el-table-column>
      <el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="配送" width="130"><template #default="scope">{{ scope.row.shipments?.length ? `${scope.row.shipments.length} 个包裹` : "未发货" }}</template></el-table-column>
      <el-table-column label="操作" width="305" fixed="right"><template #default="scope"><el-button size="small" @click="openDetail(scope.row)">详情</el-button><el-button v-if="canEdit" size="small" type="primary" plain @click="emit('edit', scope.row)">备注</el-button><el-button v-if="canEdit && scope.row.paidAt && ['PAID', 'WAITING_FULFILLMENT', 'AFTER_SALE'].includes(scope.row.status)" size="small" type="success" plain @click="emit('ship', scope.row)">发货</el-button><el-button v-if="canRefund && Number(scope.row.shippingCents) > 0 && scope.row.paidAt" size="small" type="warning" plain @click="emit('shipping-refund', scope.row)">退运费申请</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-after-sales'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无售后申请">
      <el-table-column label="售后单" min-width="210"><template #default="scope"><strong>{{ scope.row.afterSaleNo }}</strong><small>{{ dateTime(scope.row.createdAt) }}</small></template></el-table-column>
      <el-table-column label="订单" min-width="190"><template #default="scope">{{ scope.row.order?.orderNo || scope.row.orderId }}<small>订单金额 {{ money(scope.row.order?.payableCents) }}</small></template></el-table-column>
      <el-table-column label="类型 / 原因" min-width="220"><template #default="scope"><strong>{{ scope.row.type === "SHIPPING_ONLY" ? "单独退运费" : scope.row.type === "REFUND_ONLY" ? "仅退款" : scope.row.type === "RETURN_REFUND" ? "退货退款" : "换货" }}</strong><small>{{ scope.row.reason }}</small></template></el-table-column>
      <el-table-column label="现金 / 积分" min-width="180"><template #default="scope"><strong>现金 {{ money(scope.row.requestedCents) }}</strong><small>含运费 {{ scope.row.shippingRefundCents == null ? "待核验" : money(scope.row.shippingRefundCents) }}</small><small>返还积分 {{ scope.row.pointReturnCents == null ? "待核验" : money(scope.row.pointReturnCents) }}</small></template></el-table-column>
      <el-table-column label="处理状态" width="120"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="退货物流" min-width="160"><template #default="scope">{{ scope.row.returnLogisticsCompany || "—" }}<small>{{ scope.row.returnTrackingNo }}</small></template></el-table-column>
      <el-table-column label="结算" min-width="150"><template #default="scope">{{ Number(scope.row.requestedCents) === 0 && scope.row.settledAt ? "已本地结算（无现金退款）" : scope.row.refunds?.length ? scope.row.refunds.map((item: Row) => statusLabel(item.status)).join("、") : "未发起" }}<small v-if="scope.row.reviewedAt">审核 {{ dateTime(scope.row.reviewedAt) }}</small></template></el-table-column>
      <el-table-column label="操作" width="260" fixed="right"><template #default="scope"><el-button size="small" @click="openDetail(scope.row)">详情</el-button><el-button v-if="canEdit && (scope.row.type !== 'SHIPPING_ONLY' || canRefund)" size="small" type="primary" plain @click="emit('edit', scope.row)">审核</el-button><el-button v-if="canRefund && scope.row.type !== 'EXCHANGE' && (scope.row.type === 'RETURN_REFUND' ? scope.row.status === 'RETURNED' : scope.row.status === 'APPROVED')" size="small" type="danger" plain @click="emit('refund', scope.row)">{{ Number(scope.row.requestedCents) === 0 ? "结算积分" : scope.row.type === "SHIPPING_ONLY" ? "退运费" : "退款" }}</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-reviews'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无商品评价">
      <el-table-column label="商品" min-width="220"><template #default="scope"><strong>{{ scope.row.product?.displayName || scope.row.product?.name || scope.row.productId }}</strong><small>订单项 {{ scope.row.orderItemId }}</small></template></el-table-column>
      <el-table-column label="评价人" min-width="135"><template #default="scope">{{ scope.row.user?.nickname || "未命名会员" }}<small>{{ scope.row.user?.mobile }}</small></template></el-table-column>
      <el-table-column label="评价内容" min-width="320"><template #default="scope"><span>{{ scope.row.content || "用户未填写文字评价" }}</span><div v-if="scope.row.images?.length" class="review-images"><el-image v-for="image in scope.row.images.slice(0, 3)" :key="image" :src="image" fit="cover" class="review-image" /></div><small>{{ dateTime(scope.row.createdAt) }}</small></template></el-table-column>
      <el-table-column label="评分" width="120"><template #default="scope"><el-rate :model-value="Number(scope.row.rating)" disabled show-score text-color="#ff9900" /></template></el-table-column>
      <el-table-column label="展示状态" width="110"><template #default="scope"><el-tag :type="scope.row.published ? 'success' : 'info'">{{ scope.row.published ? "展示" : "隐藏" }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="105" fixed="right"><template #default="scope"><el-button v-if="canEdit" size="small" type="primary" plain @click="emit('edit', scope.row)">{{ scope.row.published ? "管理" : "恢复展示" }}</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-coupons'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无优惠券">
      <el-table-column label="优惠券" min-width="200"><template #default="scope"><strong>{{ scope.row.name }}</strong><small>满 {{ money(scope.row.minimumSpendCents) }} 可用</small></template></el-table-column>
      <el-table-column label="优惠金额" width="135"><template #default="scope"><strong class="money-text">{{ money(scope.row.value) }}</strong></template></el-table-column>
      <el-table-column label="领取 / 发行" width="135"><template #default="scope">{{ scope.row.claimedQuantity ?? scope.row._count?.claims ?? 0 }} / {{ scope.row.totalQuantity ?? "不限" }}</template></el-table-column>
      <el-table-column label="有效期" min-width="220"><template #default="scope">{{ dateTime(scope.row.validFrom) }}<small>至 {{ dateTime(scope.row.validUntil) }}</small></template></el-table-column>
      <el-table-column label="员工分发" width="130"><template #default="scope">{{ scope.row.employeeDistributable ? `允许，上限 ${scope.row.perEmployeeLimit}` : "不允许" }}</template></el-table-column>
      <el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="95" fixed="right"><template #default="scope"><el-button v-if="canEdit" size="small" type="primary" plain @click="emit('edit', scope.row)">编辑</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'commerce-employees'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无员工推广资料">
      <el-table-column label="员工" min-width="190"><template #default="scope"><strong>{{ scope.row.name }}</strong><small>{{ scope.row.mobile || "手机号未获取" }}</small></template></el-table-column>
      <el-table-column label="部门" min-width="210"><template #default="scope">{{ Array.isArray(scope.row.departmentNames) && scope.row.departmentNames.length ? scope.row.departmentNames.join(" / ") : "未获取" }}</template></el-table-column>
      <el-table-column label="推广码" min-width="180"><template #default="scope"><code>{{ scope.row.referralCode }}</code></template></el-table-column>
      <el-table-column label="冻结奖金" width="130"><template #default="scope">{{ money(scope.row.wallet?.frozenCents) }}</template></el-table-column>
      <el-table-column label="可用奖金" width="130"><template #default="scope"><strong>{{ money(scope.row.wallet?.availableCents) }}</strong></template></el-table-column>
      <el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="scope.row.active ? 'success' : 'info'">{{ scope.row.active ? "启用" : "停用" }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="95" fixed="right"><template #default="scope"><el-button size="small" @click="openDetail(scope.row)">详情</el-button></template></el-table-column>
    </el-table>

    <template v-else-if="resource === 'commerce-commissions'">
      <el-tabs v-model="commissionTab" class="commission-tabs">
        <el-tab-pane label="奖金计提" name="accruals" />
        <el-tab-pane label="钱包流水" name="ledger" />
      </el-tabs>
      <el-table v-loading="loading" :data="visibleRows" border stripe empty-text="暂无奖金记录">
        <template v-if="commissionTab === 'accruals'">
          <el-table-column label="员工" min-width="170"><template #default="scope">{{ scope.row.employee?.name || scope.row.employeeId }}<small>{{ scope.row.employee?.referralCode }}</small></template></el-table-column>
          <el-table-column label="订单" min-width="190"><template #default="scope">{{ scope.row.order?.orderNo || scope.row.orderId }}</template></el-table-column>
          <el-table-column label="计提基数" width="125"><template #default="scope">{{ money(scope.row.baseCents) }}</template></el-table-column>
          <el-table-column label="比例" width="95"><template #default="scope">{{ (Number(scope.row.rateBps || 0) / 100).toFixed(2) }}%</template></el-table-column>
          <el-table-column label="奖金" width="125"><template #default="scope"><strong>{{ money(Number(scope.row.grossBonusCents || 0) - Number(scope.row.reversedBonusCents || 0)) }}</strong></template></el-table-column>
          <el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="可用时间" width="175"><template #default="scope">{{ dateTime(scope.row.availableAt) }}</template></el-table-column>
        </template>
        <template v-else>
          <el-table-column prop="employeeId" label="员工编号" min-width="230" />
          <el-table-column prop="type" label="流水类型" min-width="150" />
          <el-table-column label="冻结变动" width="130"><template #default="scope">{{ money(scope.row.frozenDeltaCents) }}</template></el-table-column>
          <el-table-column label="可用变动" width="130"><template #default="scope">{{ money(scope.row.availableDeltaCents) }}</template></el-table-column>
          <el-table-column label="欠款变动" width="130"><template #default="scope">{{ money(scope.row.debtDeltaCents) }}</template></el-table-column>
          <el-table-column prop="memo" label="说明" min-width="230" />
          <el-table-column label="时间" width="175"><template #default="scope">{{ dateTime(scope.row.createdAt) }}</template></el-table-column>
        </template>
      </el-table>
    </template>

    <el-table v-else-if="resource === 'commerce-jobs'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无 ERP 同步任务">
      <el-table-column label="任务" min-width="240"><template #default="scope"><strong>{{ scope.row.type }}</strong><small>{{ scope.row.id }}</small></template></el-table-column>
      <el-table-column label="业务对象" min-width="190"><template #default="scope">{{ scope.row.aggregateType || "—" }}<small>{{ scope.row.aggregateId }}</small></template></el-table-column>
      <el-table-column label="状态" width="115"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="重试" width="100"><template #default="scope">{{ scope.row.attempt }} / {{ scope.row.maxAttempts }}</template></el-table-column>
      <el-table-column label="下次执行" width="175"><template #default="scope">{{ dateTime(scope.row.nextRunAt) }}</template></el-table-column>
      <el-table-column label="失败原因" min-width="240"><template #default="scope"><span :class="{ 'danger-text': scope.row.lastError }">{{ scope.row.lastError || "—" }}</span></template></el-table-column>
      <el-table-column label="操作" width="155" fixed="right"><template #default="scope"><el-button size="small" @click="openDetail(scope.row)">详情</el-button><el-button v-if="canEdit && ['FAILED', 'DEAD_LETTER'].includes(scope.row.status)" size="small" type="warning" @click="emit('run-action', `/commerce-jobs/${scope.row.id}/retry`, '任务已重新排队')">重试</el-button></template></el-table-column>
    </el-table>

    <el-table v-else-if="resource === 'payments'" v-loading="loading" :data="visibleRows" border stripe empty-text="暂无支付流水">
      <el-table-column label="支付单" min-width="235"><template #default="scope"><strong>{{ scope.row.paymentNo }}</strong><small>{{ dateTime(scope.row.createdAt) }}</small></template></el-table-column>
      <el-table-column label="业务" min-width="180"><template #default="scope">{{ scope.row.businessType }}<small>{{ scope.row.businessId }}</small></template></el-table-column>
      <el-table-column label="支付渠道" min-width="145"><template #default="scope">{{ paymentChannelLabel(scope.row.channel) }}</template></el-table-column>
      <el-table-column label="金额" width="135"><template #default="scope"><strong>{{ money(scope.row.amountCents, scope.row.currency) }}</strong></template></el-table-column>
      <el-table-column label="状态" width="115"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="支付时间" width="175"><template #default="scope">{{ dateTime(scope.row.paidAt) }}</template></el-table-column>
      <el-table-column label="操作" width="95" fixed="right"><template #default="scope"><el-button size="small" @click="openDetail(scope.row)">详情</el-button></template></el-table-column>
    </el-table>

    <div v-if="Number(meta.total) > Number(meta.pageSize)" class="pagination-row">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :current-page="Number(meta.page || 1)"
        :page-size="Number(meta.pageSize || 50)"
        :total="Number(meta.total || 0)"
        @current-change="emit('page-change', Number($event))"
      />
    </div>

    <el-drawer v-model="detailVisible" title="业务详情" size="560px">
      <AfterSaleEvidence v-if="detailVisible && resource === 'commerce-after-sales'" :key="detailRow.id" :sale-id="String(detailRow.id || '')" :references="detailRow.evidenceImages" />
      <el-descriptions :column="1" border>
        <el-descriptions-item label="编号">{{ detailRow.id || "—" }}</el-descriptions-item>
        <el-descriptions-item v-if="detailRow.orderNo" label="订单号">{{ detailRow.orderNo }}</el-descriptions-item>
        <el-descriptions-item v-if="detailRow.afterSaleNo" label="售后单号">{{ detailRow.afterSaleNo }}</el-descriptions-item>
        <el-descriptions-item v-if="detailRow.paymentNo" label="支付单号">{{ detailRow.paymentNo }}</el-descriptions-item>
        <el-descriptions-item v-if="detailRow.status" label="状态">{{ statusLabel(detailRow.status) }}</el-descriptions-item>
        <el-descriptions-item v-if="detailRow.createdAt" label="创建时间">{{ dateTime(detailRow.createdAt) }}</el-descriptions-item>
        <el-descriptions-item v-if="detailRow.updatedAt" label="更新时间">{{ dateTime(detailRow.updatedAt) }}</el-descriptions-item>
      </el-descriptions>
      <section v-if="resource === 'commerce-orders'" class="detail-section">
        <div class="section-heading"><h3>金额与收款</h3><el-button v-if="canManuallySettleOrder && detailRow.status === 'PENDING_PAYMENT' && !detailRow.paidAt && detailRow.executionOwner === 'NEW_SYSTEM'" type="primary" plain size="small" :disabled="hasActiveOnlinePayment(detailRow)" :title="hasActiveOnlinePayment(detailRow) ? '请先确认在线渠道结果或完成关单' : ''" @click="openManualOrder(detailRow)">{{ hasActiveOnlinePayment(detailRow) ? "在线支付处理中" : "调价 / 线下收款" }}</el-button></div>
        <el-alert v-if="canManuallySettleOrder && detailRow.status === 'PENDING_PAYMENT' && hasActiveOnlinePayment(detailRow)" title="该订单已有在线支付处理中记录，请先确认渠道结果或完成关单，再调价或登记线下收款。" type="warning" :closable="false" show-icon style="margin-bottom: 12px" />
        <el-descriptions :column="1" border>
          <el-descriptions-item label="商品金额">{{ money(detailRow.subtotalCents, detailRow.currency) }}</el-descriptions-item>
          <el-descriptions-item label="优惠金额">-{{ money(detailRow.discountCents, detailRow.currency) }}</el-descriptions-item>
          <el-descriptions-item label="积分抵扣">-{{ money(detailRow.pointDiscountCents, detailRow.currency) }}</el-descriptions-item>
          <el-descriptions-item label="运费">{{ money(detailRow.shippingCents, detailRow.currency) }}</el-descriptions-item>
          <el-descriptions-item label="订单应付"><strong>{{ money(detailRow.payableCents, detailRow.currency) }}</strong></el-descriptions-item>
        </el-descriptions>
        <el-table v-if="detailRow.paymentIntents?.length" :data="detailRow.paymentIntents" border style="margin-top: 12px">
          <el-table-column label="收款方式" min-width="125"><template #default="scope">{{ paymentChannelLabel(scope.row.channel) }}</template></el-table-column>
          <el-table-column label="金额" width="110"><template #default="scope">{{ money(scope.row.amountCents, scope.row.currency || detailRow.currency) }}</template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="scope">{{ statusLabel(scope.row.status) }}</template></el-table-column>
          <el-table-column label="时间" min-width="160"><template #default="scope">{{ dateTime(scope.row.paidAt || scope.row.createdAt) }}</template></el-table-column>
        </el-table>
      </section>
      <section v-if="detailRow.items?.length" class="detail-section"><h3>商品清单</h3><el-table :data="detailRow.items" border><el-table-column label="商品" min-width="170"><template #default="scope"><a v-if="storefrontProductUrl(scope.row.productId)" class="product-link" :href="storefrontProductUrl(scope.row.productId)" target="_blank" rel="noopener noreferrer">{{ scope.row.nameSnapshot }}</a><template v-else>{{ scope.row.nameSnapshot }}</template></template></el-table-column><el-table-column prop="specificationSnapshot" label="规格" min-width="130" /><el-table-column prop="quantity" label="数量" width="70" /><el-table-column label="小计" width="110"><template #default="scope">{{ money(scope.row.totalCents) }}</template></el-table-column></el-table></section>
      <ProductSkuQuickEditor v-if="detailRow.skus?.length" :key="detailRow.id" :product="detailRow" :can-edit="canEdit" @saved="productSkusSaved" />
      <section v-if="detailRow.shipments?.length" class="detail-section"><h3>物流包裹</h3><el-table :data="detailRow.shipments" border><el-table-column prop="logisticsCompany" label="物流公司" /><el-table-column prop="trackingNo" label="物流单号" /><el-table-column label="发货时间"><template #default="scope">{{ dateTime(scope.row.shippedAt) }}</template></el-table-column></el-table></section>
      <section v-if="detailRow.refunds?.length" class="detail-section"><h3>退款记录</h3><el-table :data="detailRow.refunds" border><el-table-column prop="refundNo" label="退款单" /><el-table-column label="金额"><template #default="scope">{{ money(scope.row.amountCents) }}</template></el-table-column><el-table-column label="状态"><template #default="scope">{{ statusLabel(scope.row.status) }}</template></el-table-column></el-table></section>
      <section v-if="detailRow.wallet" class="detail-section"><h3>钱包摘要</h3><el-descriptions :column="1" border><el-descriptions-item label="冻结">{{ money(detailRow.wallet.frozenCents) }}</el-descriptions-item><el-descriptions-item label="可用">{{ money(detailRow.wallet.availableCents) }}</el-descriptions-item><el-descriptions-item label="提现中">{{ money(detailRow.wallet.withdrawingCents) }}</el-descriptions-item><el-descriptions-item label="累计已付">{{ money(detailRow.wallet.totalPaidCents) }}</el-descriptions-item></el-descriptions></section>
      <section v-if="detailRow.payload" class="detail-section"><h3>任务参数</h3><pre class="detail-json">{{ jsonText(detailRow.payload) }}</pre></section>
      <section v-if="detailRow.adminRemark || detailRow.buyerRemark" class="detail-section"><h3>订单备注</h3><p>买家：{{ detailRow.buyerRemark || "—" }}</p><p class="order-admin-remark">后台：{{ detailRow.adminRemark || "—" }}</p></section>
    </el-drawer>
    <el-dialog v-model="manualOrderVisible" title="待付款订单人工处理" width="min(540px, 94vw)" :close-on-click-modal="false">
      <el-alert title="仅用于待付款订单。已有渠道支付处理中时服务端会拒绝操作；已支付状态不能在这里撤回。" type="warning" :closable="false" show-icon />
      <el-form label-width="110px" style="margin-top: 18px">
        <el-form-item label="订单号"><el-input :model-value="detailRow.orderNo" disabled /></el-form-item>
        <el-form-item label="订单应付">
          <el-input-number v-model="manualOrderForm.payableYuan" :min="0.01" :max="21474836.47" :precision="2" :step="1" controls-position="right" /><span class="muted" style="margin-left: 8px">元</span>
        </el-form-item>
        <el-form-item label="支付状态">
          <el-select v-model="manualOrderForm.action" style="width: 100%"><el-option label="保持待付款（只调价）" value="ADJUST_PRICE" /><el-option label="已线下收款，标记为已支付" value="CONFIRM_OFFLINE_PAID" /></el-select>
        </el-form-item>
        <el-form-item label="处理备注"><el-input v-model="manualOrderForm.note" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="必填，例如：2026-09-11 银行转账到账，财务已核对" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="manualOrderSaving" @click="manualOrderVisible = false">取消</el-button><el-button type="primary" :loading="manualOrderSaving" @click="saveManualOrder">确认保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.commerce-workspace { display: grid; gap: 18px; }
.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.metric-card { min-height: 98px; padding: 18px 20px; border: 1px solid #e4e9f0; border-radius: 12px; background: #fff; box-shadow: 0 3px 12px rgb(16 24 40 / 4%); }
.metric-card span { display: block; margin-bottom: 10px; color: #768396; font-size: 13px; }
.metric-card strong { color: #182230; font-size: 24px; line-height: 1.2; }
.commerce-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px; border: 1px solid #e4e9f0; border-radius: 12px; background: #fff; }
.search-input { flex: 1 1 260px; width: 320px; }
.status-select { width: 160px; }
.result-count { margin-left: auto; color: #768396; font-size: 13px; }
.pagination-row { display: flex; justify-content: flex-end; padding: 4px 0; }
.thumb, .image-fallback { width: 58px; height: 58px; border-radius: 8px; }
.category-icon, .category-icon + .image-fallback { width: 48px; height: 48px; border-radius: 8px; }
.banner-thumb, .banner-fallback { width: 150px; height: 64px; border-radius: 8px; }
.image-fallback, .banner-fallback { display: grid; place-items: center; color: #98a2b3; background: #f1f4f7; font-size: 12px; }
strong { font-weight: 650; }
small { display: block; margin-top: 5px; color: #768396; line-height: 1.45; }
.tag-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.review-images { display: flex; gap: 6px; margin-top: 8px; }
.review-image { width: 44px; height: 44px; border-radius: 6px; }
.money-text { color: #d94f2b; font-size: 16px; }
.product-link { color: #1769aa; font-weight: 600; line-height: 1.55; text-decoration: none; }
.product-link:hover { color: #0b4f87; text-decoration: underline; }
.danger-text { color: #d92d20; }
code { color: #344054; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; }
.json-preview { max-height: 70px; margin: 0; overflow: hidden; color: #475467; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
.commission-tabs { padding: 0 16px; border: 1px solid #e4e9f0; border-radius: 12px; background: #fff; }
.detail-section { margin-top: 24px; }
.detail-section h3 { margin: 0 0 12px; font-size: 16px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.section-heading h3 { margin: 0; }
.order-admin-remark { white-space: pre-wrap; }
.detail-json { padding: 14px; overflow: auto; border-radius: 8px; background: #f5f7fa; color: #344054; font-size: 12px; white-space: pre-wrap; }
:deep(.el-table) { border-radius: 12px; }
:deep(.el-table th.el-table__cell) { background: #f7f9fc; color: #475467; font-weight: 650; }
:deep(.el-rate) { height: auto; }
@media (max-width: 1280px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
