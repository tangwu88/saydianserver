<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { canAdminResource } from "@saydian/app-contracts";
import { api, getAdminRoles, readableError, responseData } from "../api";
import {
  partnerAccountErrors,
  partnerAccountFields,
} from "../partner-account-form";
const route = useRoute(),
  resource = computed(() => route.path.slice(1)),
  levels = ref<any[]>([]),
  partners = ref<any[]>([]),
  prices = ref<any[]>([]),
  total = ref(0),
  page = ref(1),
  pricePageSize = ref(10),
  categoryId = ref(""),
  categories = ref<any[]>([]),
  search = ref(""),
  levelId = ref(""),
  partnerId = ref(""),
  loading = ref(false),
  saving = ref(false);
const dialog = ref(false),
  dialogType = ref("account"),
  edit = ref<any>(),
  form = reactive<any>({}),
  promotion = ref<any>(),
  funds = ref<any>(),
  ledger = ref<any[]>([]),
  financeTab = ref("ledger"),
  recharges = ref<any[]>([]),
  financeOrders = ref<any[]>([]),
  selectedPartner = ref<any>(),
  orderDetail = ref<any>();
const pendingFunds = ref<{ url: string; body: Record<string, unknown> }>();
const selectedPrices = ref<any[]>([]),
  importDialog = ref(false),
  importRows = ref<any[]>([]),
  importSelected = ref<any[]>([]),
  importSearch = ref(""),
  importPage = ref(1),
  importTotal = ref(0),
  importBusy = ref(false),
  importLevel = ref(""),
  editPriceLevel = ref("");
const allPricesSelected = computed(
  () =>
    prices.value.length > 0 &&
    prices.value.every((product) => product.skus.every(isPriceSelected)),
);
function isPriceSelected(sku: any) {
  return selectedPrices.value.some((row) => row.id === sku.id);
}
function togglePrices(skus: any[], checked: boolean) {
  const ids = new Set(skus.map((sku) => sku.id));
  const kept = selectedPrices.value.filter((sku) => !ids.has(sku.id));
  selectedPrices.value = checked ? [...kept, ...skus] : kept;
}
function priceRange(skus: any[], cooperation: boolean) {
  const values = skus
    .map((sku) => (cooperation ? sku.price?.priceCents : sku.salePriceCents))
    .filter((n: unknown): n is number => typeof n === "number");
  if (!values.length) return "未设置";
  const min = Math.min(...values),
    max = Math.max(...values);
  return min === max ? money(min) : `${money(min)} ~ ${money(max)}`;
}
let importRequest = 0;
async function loadImport() {
  const request = ++importRequest;
  importBusy.value = true;
  importRows.value = [];
  importSelected.value = [];
  try {
    const result = responseData<any>(
      await api.get("/partner-prices/import-options", {
        params: {
          levelId: importLevel.value,
          search: importSearch.value,
          page: importPage.value,
        },
      }),
    );
    if (request === importRequest) {
      importRows.value = result.items;
      importTotal.value = result.total;
    }
  } catch (cause) {
    if (request === importRequest) ElMessage.error(readableError(cause));
  } finally {
    if (request === importRequest) importBusy.value = false;
  }
}
function openImport() {
  if (!canPrice.value || !levelId.value) return;
  importLevel.value = levelId.value;
  importPage.value = 1;
  importSearch.value = "";
  importTotal.value = 0;
  importDialog.value = true;
  void loadImport();
}
async function importProducts() {
  if (!canPrice.value || saving.value || !importSelected.value.length) return;
  saving.value = true;
  try {
    const result = responseData<any>(
      await api.post(`/partner-prices/${importLevel.value}/import`, {
        skuIds: importSelected.value.map((row) => row.id),
      }),
    );
    ElMessage.success(
      `已导入 ${result.imported} 个规格，已存在 ${result.skipped} 个；请编辑并启用合作价`,
    );
    importDialog.value = false;
    page.value = 1;
    await load();
  } catch (cause) {
    ElMessage.error(readableError(cause));
  } finally {
    saving.value = false;
  }
}
async function deleteProducts() {
  if (!canPrice.value || saving.value || !selectedPrices.value.length) return;
  if (selectedPrices.value.length > 100) {
    ElMessage.warning("每次最多删除100个规格，请减少选择");
    return;
  }
  const targetLevel = levelId.value,
    items = selectedPrices.value.map((row) => ({
      skuId: row.id,
      updatedAt: row.price.updatedAt,
    }));
  saving.value = true;
  try {
    await ElMessageBox.confirm(
      `从当前合作等级移除选中的 ${items.length} 个规格？商城商品、ERP 编码及历史订单将保留。`,
      "批量删除",
      { type: "warning" },
    );
    await api.post(`/partner-prices/${targetLevel}/batch-delete`, { items });
    ElMessage.success("已删除所选伙伴商品配置");
    page.value = 1;
    await load();
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close")
      ElMessage.error(readableError(cause));
  } finally {
    saving.value = false;
  }
}
const ledgerDetail = ref<any>();
let financeRequest = 0;
onBeforeUnmount(() => {
  financeRequest++;
  priceListRequest++;
});
const accountForm = ref<FormInstance>();
const memberDialog = ref(false),
  memberOptions = ref<any[]>([]),
  linkedMemberId = ref<string | null>(null),
  linkingPartner = ref<any>(),
  memberBusy = ref(false);
let memberQuery = 0;
async function searchMembers(query: string) {
  const request = ++memberQuery;
  memberBusy.value = true;
  try {
    const result = responseData<any>(
      await api.get("/members", { params: { search: query, pageSize: 30 } }),
    );
    if (request === memberQuery) memberOptions.value = result.items;
  } catch (cause) {
    ElMessage.error(readableError(cause));
  } finally {
    if (request === memberQuery) memberBusy.value = false;
  }
}
function openMemberLink(row: any) {
  linkingPartner.value = row;
  linkedMemberId.value = row.linkedMemberId;
  memberDialog.value = true;
  void searchMembers("");
}
async function saveMemberLink() {
  if (saving.value) return;
  try {
    await ElMessageBox.confirm(
      "绑定后，该会员可从商城进入此合作账户并在微信内充值。旧登录会话将失效。请核对会员身份。",
      "确认绑定",
      { confirmButtonText: "确认", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  saving.value = true;
  try {
    await api.post(`/partners/${linkingPartner.value.id}/link-member`, {
      memberId: linkedMemberId.value || null,
    });
    memberDialog.value = false;
    ElMessage.success("绑定已更新");
    await load();
  } catch (cause) {
    ElMessage.error(readableError(cause));
  } finally {
    saving.value = false;
  }
}
const accountRules = computed<FormRules>(() =>
  dialogType.value === "account"
    ? Object.fromEntries(
        partnerAccountFields.map((field) => [
          field,
          [
            {
              trigger: field === "levelId" ? "change" : "blur",
              validator: (
                _rule: unknown,
                _value: unknown,
                done: (error?: Error) => void,
              ) => {
                const message = partnerAccountErrors(
                  form,
                  !edit.value,
                  levels.value,
                )[field];
                done(message ? new Error(message) : undefined);
              },
            },
          ],
        ]),
      )
    : {},
);
const canManage = computed(() =>
    canAdminResource(getAdminRoles(), "partners", "write"),
  ),
  canPrice = computed(() =>
    canAdminResource(getAdminRoles(), "partner-prices", "write"),
  ),
  canFinance = computed(() =>
    canAdminResource(getAdminRoles(), "partner-finance", "write"),
  );
const labels: Record<string, string> = {
  partners: "品牌伙伴账户",
  "partner-levels": "合作等级",
  "partner-prices": "等级合作价",
  "partner-finance": "品牌伙伴资金",
};
function money(value: unknown) {
  return value == null ? "未设置" : `¥${(Number(value) / 100).toFixed(2)}`;
}
function date(value: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
const ledgerLabels: Record<string, string> = {
  RECHARGE: "在线充值",
  MANUAL_RECHARGE: "手动充值余额",
  PURCHASE: "采购消费",
  REFUND: "采购退款",
  DEPOSIT_RECEIPT: "保证金收取",
  DEPOSIT_RETURN: "保证金退还",
  DEPOSIT_CORRECTION: "保证金更正",
};
async function loadPartners(searchInput = search.value) {
  const result = responseData<any>(
    await api.get("/partners", {
      params: {
        search: searchInput,
        page:
          resource.value === "partners" ||
          (resource.value === "partner-finance" && !partnerId.value)
            ? page.value
            : 1,
      },
    }),
  );
  partners.value = result.items;
  if (
    resource.value === "partners" ||
    (resource.value === "partner-finance" && !partnerId.value)
  )
    total.value = result.total;
}
let priceListRequest = 0;
async function filterPrices() {
  page.value = 1;
  await load();
}
async function changePricePagination(nextPage: number, nextSize: number) {
  if (page.value === nextPage && pricePageSize.value === nextSize) return;
  page.value = nextSize === pricePageSize.value ? nextPage : 1;
  pricePageSize.value = nextSize;
  await load();
}
async function load() {
  const request = ++priceListRequest;
  selectedPrices.value = [];
  loading.value = true;
  try {
    const loadedLevels = responseData<any[]>(await api.get("/partner-levels"));
    if (request !== priceListRequest) return;
    levels.value = loadedLevels;
    if (!levelId.value && levels.value.length)
      levelId.value = levels.value[0].id;
    if (resource.value === "partner-prices") {
      if (levelId.value) {
        const result = responseData<any>(
          await api.get("/partner-prices", {
            params: {
              levelId: levelId.value,
              search: search.value,
              page: page.value,
              groupBy: "product",
              pageSize: pricePageSize.value,
              categoryId: categoryId.value,
            },
          }),
        );
        if (request !== priceListRequest) return;
        categories.value = result.categories ?? [];
        prices.value = result.items;
        total.value = result.total;
      }
    } else if (
      resource.value === "partners" ||
      resource.value === "partner-finance"
    ) {
      await loadPartners();
      if (resource.value === "partner-finance" && partnerId.value)
        await loadFinance();
    }
  } catch (cause) {
    if (request === priceListRequest) {
      if (resource.value === "partner-prices") { prices.value = []; total.value = 0; }
      ElMessage.error(readableError(cause));
    }
  } finally {
    if (request === priceListRequest) loading.value = false;
  }
}
onMounted(load);
async function loadFinance() {
  const request = ++financeRequest,
    selectedPartner = partnerId.value;
  funds.value = null;
  ledger.value = [];
  recharges.value = [];
  financeOrders.value = [];
  if (!selectedPartner) return;
  try {
    const [wallet, records, charges, orders] = await Promise.all([
      api.get(`/partner-finance/${selectedPartner}/wallet`),
      api.get(`/partner-finance/${selectedPartner}/ledger`, {
        params: { page: page.value },
      }),
      api.get(`/partner-finance/${selectedPartner}/recharges`, {
        params: { page: page.value },
      }),
      api.get(`/partner-finance/${selectedPartner}/orders`, {
        params: { page: page.value },
      }),
    ]);
    if (request !== financeRequest || selectedPartner !== partnerId.value)
      return;
    funds.value = responseData(wallet);
    ledger.value = responseData<any>(records).items;
    recharges.value = responseData<any>(charges).items;
    financeOrders.value = responseData<any>(orders).items;
    total.value =
      financeTab.value === "orders"
        ? responseData<any>(orders).total
        : financeTab.value === "ledger"
          ? responseData<any>(records).total
          : responseData<any>(charges).total;
  } catch (cause) {
    if (request === financeRequest) ElMessage.error(readableError(cause));
  }
}
async function selectFinance(row: any, action = "ledger") {
  if (pendingFunds.value || saving.value) {
    dialog.value = true;
    return;
  }
  selectedPartner.value = row;
  partnerId.value = row.id;
  page.value = 1;
  financeTab.value = action === "orders" ? "orders" : "ledger";
  await loadFinance();
  if (action === "balance" || action === "deposit") open(action);
}
function backToPartners() {
  if (pendingFunds.value || saving.value) return;
  financeRequest++;
  partnerId.value = "";
  selectedPartner.value = undefined;
  page.value = 1;
  funds.value = null;
  void load();
}
function open(type: string, row?: any) {
  if (pendingFunds.value) {
    dialog.value = true;
    ElMessage.info("请先核对上次资金登记结果");
    return;
  }
  accountForm.value?.clearValidate();
  dialogType.value = type;
  edit.value = row ?? null;
  Object.keys(form).forEach((key) => delete form[key]);
  if (type === "account")
    Object.assign(
      form,
      row
        ? {
            name: row.name,
            mobile: row.mobile,
            levelId: row.levelId,
            active: row.active,
            updatedAt: row.updatedAt,
          }
        : {
            username: "",
            name: "",
            mobile: "",
            password: "",
            levelId:
              levelId.value || levels.value.find((level) => level.active)?.id,
          },
    );
  if (type === "level")
    Object.assign(
      form,
      row
        ? {
            name: row.name,
            sort: row.sort,
            active: row.active,
            updatedAt: row.updatedAt,
          }
        : { name: "", sort: levels.value.length + 1, active: true },
    );
  if (type === "price")
    Object.assign(form, {
      amount: row.price ? row.price.priceCents / 100 : undefined,
      enabled: row.price?.enabled ?? true,
      productName: row.product.name,
      specification: row.specification ?? "",
      retailAmount: row.salePriceCents / 100,
    });
  if (type === "price") editPriceLevel.value = levelId.value;
  if (type === "deposit" || type === "balance")
    Object.assign(form, {
      amount: 0,
      type: "DEPOSIT_RECEIPT",
      reason: "",
      referenceNo: "",
      idempotencyKey: crypto.randomUUID(),
    });
  dialog.value = true;
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (
      dialogType.value === "account" &&
      !(await accountForm.value?.validate().catch(() => false))
    )
      return;
    if (dialogType.value === "account") {
      if (edit.value)
        await api.patch(`/partners/${edit.value.id}`, { ...form });
      else await api.post("/partners", { ...form });
    } else if (dialogType.value === "level") {
      if (edit.value)
        await api.patch(`/partner-levels/${edit.value.id}`, { ...form });
      else await api.post("/partner-levels", { ...form });
    } else if (dialogType.value === "price") {
      await api.patch(
        `/partner-prices/${editPriceLevel.value}/${edit.value.id}`,
        {
          priceCents: Math.round(Number(form.amount) * 100),
          productName: form.productName,
          specification: form.specification,
          retailPriceCents: Math.round(Number(form.retailAmount) * 100),
          enabled: form.enabled,
          updatedAt: edit.value.price?.updatedAt ?? null,
        },
      );
    } else {
      if (!canFinance.value || !partnerId.value) {
        ElMessage.error("仅超级管理员可以登记伙伴资金");
        return;
      }
      const amountCents = Math.round(Number(form.amount) * 100),
        deltaCents =
          form.type === "DEPOSIT_RETURN" ? -Math.abs(amountCents) : amountCents;
      if (!pendingFunds.value) {
        if (
          !Number.isSafeInteger(amountCents) ||
          !amountCents ||
          Math.abs(amountCents) > 2147483647 ||
          (dialogType.value === "balance" && amountCents < 0) ||
          !String(form.reason || "").trim()
        ) {
          ElMessage.warning("请填写有效金额和登记原因");
          return;
        }
        const partner = partners.value.find(
          (item) => item.id === partnerId.value,
        );
        try {
          await ElMessageBox.confirm(
            `${partner?.name || partnerId.value}：${dialogType.value === "balance" ? "可消费余额" : "保证金"} ${deltaCents > 0 ? "增加" : "减少"} ${money(Math.abs(deltaCents))}。原因：${String(form.reason).trim()}`,
            "确认资金入账",
            {
              confirmButtonText: "确认入账",
              cancelButtonText: "返回修改",
              type: "warning",
            },
          );
        } catch {
          return;
        }
        pendingFunds.value = {
          url: `/partner-finance/${partnerId.value}/${dialogType.value === "balance" ? "balance-recharge" : "deposit"}`,
          body: {
            ...(dialogType.value === "balance"
              ? { amountCents }
              : { deltaCents, type: form.type }),
            reason: String(form.reason).trim(),
            referenceNo: String(form.referenceNo || "").trim(),
            idempotencyKey: form.idempotencyKey,
          },
        };
      }
      await api.post(pendingFunds.value.url, pendingFunds.value.body);
      pendingFunds.value = undefined;
    }
    ElMessage.success("已保存");
    dialog.value = false;
    await load();
  } catch (cause) {
    if (
      axios.isAxiosError(cause) &&
      [400, 404, 409, 422].includes(cause.response?.status ?? 0)
    )
      pendingFunds.value = undefined;
    ElMessage.error(readableError(cause));
  } finally {
    saving.value = false;
  }
}
async function reset(row: any) {
  try {
    const result = await ElMessageBox.prompt(
      "请输入10至128个字符的新密码，原登录会话将立即失效。",
      `重置 ${row.name} 的密码`,
      {
        inputType: "password",
        inputValidator: (value) =>
          (value.length >= 10 && value.length <= 128) ||
          "密码须为10至128个字符",
      },
    );
    await api.post(`/partners/${row.id}/reset-password`, {
      password: result.value,
    });
    ElMessage.success("密码已重置，旧会话已失效");
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close")
      ElMessage.error(readableError(cause));
  }
}
async function showPromotion(row: any) {
  try {
    promotion.value = responseData(
      await api.get(`/partners/${row.id}/promotion`),
    );
  } catch (cause) {
    ElMessage.error(readableError(cause));
  }
}
async function copyPromotion() {
  try {
    await navigator.clipboard.writeText(promotion.value.linkUrl);
    ElMessage.success("链接已复制");
  } catch {
    ElMessage.info("请选中链接复制");
  }
}
</script>
<template>
  <section class="page">
    <div class="head">
      <h1 class="page-title">{{ labels[resource] }}</h1>
      <a href="/vip/" target="_blank" rel="noopener">打开赛电品牌伙伴平台 ↗</a>
    </div>
    <div class="toolbar">
      <el-input
        v-if="
          resource !== 'partner-levels' &&
          !(resource === 'partner-finance' && partnerId)
        "
        v-model="search"
        clearable
        :placeholder="
          resource === 'partner-prices'
            ? '搜索商品'
            : '搜索伙伴名称、账号或编号'
        "
        style="width: 300px"
        @keyup.enter="
          page = 1;
          load();
        "
      /><el-select
        v-if="resource === 'partner-prices'"
        v-model="levelId"
        style="width: 160px"
        @change="
          page = 1;
          load();
        "
        ><el-option
          v-for="level in levels"
          :key="level.id"
          :value="level.id"
          :label="level.name" /></el-select
      ><el-select v-if="resource === 'partner-prices'" v-model="categoryId" clearable filterable placeholder="全部分类" aria-label="商品分类" style="width: 220px" @change="filterPrices">
        <el-option label="未分类" value="uncategorized" />
        <el-option v-for="category in categories" :key="category.id" :value="category.id" :label="category.label" />
      </el-select><el-button
        @click="
          page = 1;
          load();
        "
        >查询 / 刷新</el-button
      ><el-button
        v-if="resource === 'partners' && canManage"
        type="primary"
        @click="open('account')"
        >新增品牌伙伴</el-button
      ><el-button
        v-if="resource === 'partner-levels' && canPrice"
        type="primary"
        @click="open('level')"
        >新增等级</el-button
      >
    </div>
    <div v-if="resource === 'partner-finance' && partnerId" class="toolbar">
      <el-button :disabled="saving || !!pendingFunds" @click="backToPartners"
        >返回伙伴列表</el-button
      >
      <b>{{ selectedPartner?.name }}</b
      ><span class="muted">{{ selectedPartner?.partnerNo }}</span>
    </div>
    <div v-loading="loading">
      <el-table v-if="resource === 'partners'" :data="partners" border stripe
        ><el-table-column
          prop="partnerNo"
          label="伙伴编号"
          min-width="230"
        /><el-table-column
          prop="name"
          label="伙伴名称"
          min-width="160"
        /><el-table-column
          prop="username"
          label="登录账号"
          min-width="140"
        /><el-table-column label="合作等级" width="120"
          ><template #default="scope">{{
            scope.row.level.name
          }}</template></el-table-column
        ><el-table-column label="会员" width="75"
          ><template #default="scope">{{
            scope.row._count.members
          }}</template></el-table-column
        ><el-table-column label="可消费余额" width="140"
          ><template #default="scope">{{
            money(scope.row.wallet?.balanceCents)
          }}</template></el-table-column
        ><el-table-column label="状态" width="90"
          ><template #default="scope"
            ><el-tag :type="scope.row.active ? 'success' : 'info'">{{
              scope.row.active ? "启用" : "停用"
            }}</el-tag></template
          ></el-table-column
        ><el-table-column label="操作" min-width="230" fixed="right"
          ><template #default="scope"
            ><el-button text @click="showPromotion(scope.row)">二维码</el-button
            ><el-button
              v-if="canManage"
              text
              @click="open('account', scope.row)"
              >编辑</el-button
            ><el-button v-if="canManage" text @click="reset(scope.row)"
              >重置密码</el-button
            ><el-button
              v-if="canManage"
              text
              @click="openMemberLink(scope.row)"
              >{{
                scope.row.linkedMemberId ? "会员绑定" : "绑定商城会员"
              }}</el-button
            ></template
          ></el-table-column
        ></el-table
      >
      <el-table
        v-if="resource === 'partner-levels'"
        :data="levels"
        border
        stripe
        ><el-table-column prop="name" label="合作等级" /><el-table-column
          prop="code"
          label="等级代码"
        /><el-table-column prop="sort" label="排序" /><el-table-column
          label="状态"
          ><template #default="scope">{{
            scope.row.active ? "启用" : "停用"
          }}</template></el-table-column
        ><el-table-column v-if="canPrice" label="操作"
          ><template #default="scope"
            ><el-button @click="open('level', scope.row)"
              >编辑</el-button
            ></template
          ></el-table-column
        ></el-table
      >
      <div v-if="resource === 'partner-prices'" style="margin: 12px 0">
        <p>
          按商城商品汇总已导入规格，展开可编辑或单独选择规格。名称、零售价与合作价独立维护，库存及
          ERP 编码沿用商城原规格。
        </p>
        <el-button
          v-if="canPrice"
          type="primary"
          :disabled="!levelId || saving"
          @click="openImport"
          >从商城导入</el-button
        >
        <el-button
          v-if="canPrice"
          type="danger"
          :disabled="!selectedPrices.length || saving || loading"
          @click="deleteProducts"
          >批量删除（{{ selectedPrices.length }}）</el-button
        >
      </div>
      <el-table
        v-if="resource === 'partner-prices'"
        :data="prices"
        row-key="id"
        border
        stripe
      >
        <el-table-column v-if="canPrice" width="45">
          <template #header
            ><el-checkbox
              :model-value="allPricesSelected"
              :indeterminate="selectedPrices.length > 0 && !allPricesSelected"
              :disabled="saving || !prices.length"
              aria-label="选择本页全部规格"
              @change="
                togglePrices(
                  prices.flatMap((p: any) => p.skus),
                  !!$event,
                )
              "
          /></template>
          <template #default="scope"
            ><el-checkbox
              :model-value="scope.row.skus.every(isPriceSelected)"
              :indeterminate="
                scope.row.skus.some(isPriceSelected) &&
                !scope.row.skus.every(isPriceSelected)
              "
              :disabled="saving"
              aria-label="选择此商品全部规格"
              @change="togglePrices(scope.row.skus, !!$event)"
          /></template>
        </el-table-column>
        <el-table-column type="expand"
          ><template #default="scope">
            <el-table :data="scope.row.skus" row-key="id" border stripe
              ><el-table-column v-if="canPrice" width="45"
                ><template #default="cell"
                  ><el-checkbox
                    :model-value="isPriceSelected(cell.row)"
                    :disabled="saving"
                    aria-label="选择此规格"
                    @change="togglePrices([cell.row], !!$event)" /></template
              ></el-table-column>
              <el-table-column label="商品" min-width="200"
                ><template #default="cell">{{
                  cell.row.product.name
                }}</template></el-table-column
              ><el-table-column
                prop="specification"
                label="规格"
                min-width="140"
              /><el-table-column label="零售价" width="140"
                ><template #default="cell">{{
                  money(cell.row.salePriceCents)
                }}</template></el-table-column
              ><el-table-column
                prop="erpSkuId"
                label="原 ERP 规格编码"
                min-width="150"
              />
              <el-table-column label="合作价" width="140"
                ><template #default="cell">{{
                  money(cell.row.price?.priceCents)
                }}</template></el-table-column
              ><el-table-column label="采购状态" width="120"
                ><template #default="cell">{{
                  cell.row.price?.enabled ? "价格已启用" : "暂不可采购"
                }}</template></el-table-column
              ><el-table-column v-if="canPrice" label="操作" width="120"
                ><template #default="cell"
                  ><el-button @click="open('price', cell.row)"
                    >编辑商品</el-button
                  ></template
                ></el-table-column
              ></el-table
            >
          </template></el-table-column
        >
        <el-table-column label="商品" min-width="260"
          ><template #default="scope"
            ><div style="display: flex; gap: 12px; align-items: center">
              <el-image
                v-if="scope.row.coverImage"
                :src="scope.row.coverImage"
                fit="cover"
                style="width: 56px; height: 56px; flex-shrink: 0"
              /><span
                >{{ scope.row.name
                }}<small
                  v-if="scope.row.source === 'ERP'"
                  style="display: block; color: #909399"
                  >款式：{{ scope.row.erpItemId }}</small
                ></span
              >
            </div></template
          ></el-table-column
        >
        <el-table-column label="规格" width="110"
          ><template #default="scope"
            >{{ scope.row.skus.length }} 个规格</template
          ></el-table-column
        >
        <el-table-column label="零售价" min-width="160"
          ><template #default="scope">{{
            priceRange(scope.row.skus, false)
          }}</template></el-table-column
        >
        <el-table-column label="合作价" min-width="160"
          ><template #default="scope">{{
            priceRange(scope.row.skus, true)
          }}</template></el-table-column
        >
        <el-table-column label="采购状态" width="180"
          ><template #default="scope"
            >{{
              scope.row.skus.filter(
                (sku: any) =>
                  sku.price?.enabled &&
                  sku.enabled &&
                  scope.row.status === "PUBLISHED",
              ).length
            }}
            / {{ scope.row.skus.length }} 个规格可采购</template
          ></el-table-column
        >
      </el-table>
      <template v-if="resource === 'partner-finance'"
        ><el-table v-if="!partnerId" :data="partners" border stripe>
          <el-table-column prop="name" label="伙伴名称" min-width="140" />
          <el-table-column prop="username" label="登录账号" min-width="120" />
          <el-table-column label="合作等级" min-width="120"
            ><template #default="scope">{{
              scope.row.level.name
            }}</template></el-table-column
          >
          <el-table-column label="可消费余额" width="145"
            ><template #default="scope">{{
              money(scope.row.wallet?.balanceCents)
            }}</template></el-table-column
          >
          <el-table-column label="保证金" width="145"
            ><template #default="scope">{{
              money(scope.row.wallet?.depositCents)
            }}</template></el-table-column
          >
          <el-table-column label="采购订单" width="100"
            ><template #default="scope">{{
              scope.row._count.orders
            }}</template></el-table-column
          >
          <el-table-column label="状态" width="80"
            ><template #default="scope">{{
              scope.row.active ? "启用" : "停用"
            }}</template></el-table-column
          >
          <el-table-column label="操作" min-width="335" fixed="right"
            ><template #default="scope">
              <el-button
                v-if="canFinance"
                text
                type="primary"
                @click="selectFinance(scope.row, 'balance')"
                >充值余额</el-button
              >
              <el-button
                v-if="canFinance"
                text
                type="primary"
                @click="selectFinance(scope.row, 'deposit')"
                >充保证金</el-button
              >
              <el-button text @click="selectFinance(scope.row, 'orders')"
                >查看下单</el-button
              >
              <el-button text @click="selectFinance(scope.row)"
                >余额明细</el-button
              >
            </template></el-table-column
          > </el-table
        ><template v-else-if="funds"
          ><div class="funds">
            <el-card
              ><span class="muted">可消费余额</span>
              <h2>{{ money(funds.balanceCents) }}</h2>
              <el-button
                v-if="canFinance"
                type="primary"
                @click="open('balance')"
                >手动充值余额</el-button
              ></el-card
            ><el-card
              ><span class="muted">保证金</span>
              <h2>{{ money(funds.depositCents) }}</h2>
              <el-button
                v-if="canFinance"
                type="primary"
                @click="open('deposit')"
                >登记保证金</el-button
              ></el-card
            >
          </div>
          <el-tabs
            v-model="financeTab"
            @tab-change="
              page = 1;
              loadFinance();
            "
            ><el-tab-pane label="资金流水" name="ledger" /><el-tab-pane
              label="在线充值记录"
              name="recharges" /><el-tab-pane
              label="采购订单"
              name="orders" /></el-tabs
          ><el-table v-if="financeTab === 'ledger'" :data="ledger" border stripe
            ><el-table-column label="账户" width="110"
              ><template #default="scope">{{
                scope.row.account === "BALANCE" ? "消费余额" : "保证金"
              }}</template></el-table-column
            ><el-table-column label="类型" width="140"
              ><template #default="scope">{{
                ledgerLabels[scope.row.type] || scope.row.type
              }}</template></el-table-column
            ><el-table-column label="金额变动" width="140"
              ><template #default="scope">{{
                money(scope.row.deltaCents)
              }}</template></el-table-column
            ><el-table-column label="变动后余额" width="140"
              ><template #default="scope">{{
                money(scope.row.balanceAfterCents)
              }}</template></el-table-column
            ><el-table-column prop="operatorName" label="操作人" min-width="140"
              ><template #default="scope"
                >{{ scope.row.operatorName || "系统 / 历史记录" }}
                <div class="muted">
                  {{ scope.row.operatorUsername || "" }}
                </div></template
              ></el-table-column
            ><el-table-column label="时间" min-width="180"
              ><template #default="scope">{{
                date(scope.row.createdAt)
              }}</template></el-table-column
            ><el-table-column label="详情" width="95" fixed="right"
              ><template #default="scope"
                ><el-button
                  text
                  type="primary"
                  @click="ledgerDetail = scope.row"
                  >查看日志</el-button
                ></template
              ></el-table-column
            ></el-table
          ><el-table
            v-else-if="financeTab === 'recharges'"
            :data="recharges"
            border
            stripe
            ><el-table-column
              prop="rechargeNo"
              label="充值编号"
              min-width="250"
            /><el-table-column label="金额"
              ><template #default="scope">{{
                money(scope.row.amountCents)
              }}</template></el-table-column
            ><el-table-column prop="channel" label="渠道" /><el-table-column
              label="状态"
              ><template #default="scope">{{
                scope.row.status === "SUCCEEDED" ? "已入账" : "待确认"
              }}</template></el-table-column
            ><el-table-column label="时间" min-width="180"
              ><template #default="scope">{{
                date(scope.row.createdAt)
              }}</template></el-table-column
            ></el-table
          ><el-table v-else :data="financeOrders" border stripe>
            <el-table-column prop="orderNo" label="采购订单" min-width="235" />
            <el-table-column label="商品" min-width="240"
              ><template #default="scope"
                ><div v-for="item in scope.row.items" :key="item.id">
                  {{ item.nameSnapshot }} × {{ item.quantity }}
                </div></template
              ></el-table-column
            >
            <el-table-column label="订单金额" width="130"
              ><template #default="scope">{{
                money(scope.row.payableCents)
              }}</template></el-table-column
            >
            <el-table-column label="下单时间" min-width="180"
              ><template #default="scope">{{
                date(scope.row.createdAt)
              }}</template></el-table-column
            >
            <el-table-column label="操作" width="100"
              ><template #default="scope"
                ><el-button text @click="orderDetail = scope.row"
                  >详情</el-button
                ></template
              ></el-table-column
            >
          </el-table></template
        ></template
      >
      <el-pagination v-if="resource === 'partner-prices'" :current-page="page" :page-size="pricePageSize" :page-sizes="[10, 20, 50, 100]" :total="total" :disabled="loading" layout="total, sizes, prev, pager, next" @current-change="changePricePagination($event, pricePageSize)" @size-change="changePricePagination(1, $event)" />
      <el-pagination
        v-else-if="resource !== 'partner-levels'"
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="
          resource === 'partner-finance' && partnerId ? loadFinance() : load()
        "
      />
    </div>
    <el-dialog
      :model-value="!!orderDetail"
      title="采购订单详情"
      width="min(760px, 94vw)"
      @close="orderDetail = null"
    >
      <template v-if="orderDetail"
        ><b>{{ orderDetail.orderNo }}</b>
        <p>付款金额：{{ money(orderDetail.payableCents) }}</p>
        <p>
          {{ orderDetail.recipientName }} · {{ orderDetail.recipientMobile }}
        </p>
        <p>
          {{ orderDetail.province }} {{ orderDetail.city }}
          {{ orderDetail.district }} {{ orderDetail.addressDetail }}
        </p>
        <p v-for="item in orderDetail.items" :key="item.id">
          {{ item.nameSnapshot }} · {{ item.specificationSnapshot }} ×
          {{ item.quantity }} · {{ money(item.unitPriceCents) }}
        </p>
        <p v-for="shipment in orderDetail.shipments" :key="shipment.trackingNo">
          {{ shipment.logisticsCompany }} · {{ shipment.trackingNo }} ·
          {{ date(shipment.shippedAt) }}
        </p>
        <p v-if="!orderDetail.shipments.length" class="muted">尚未发货</p>
      </template>
    </el-dialog>
    <el-dialog
      v-model="importDialog"
      title="从商城商品列表导入规格"
      width="min(1000px, 95vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :show-close="!saving"
    >
      <p>
        导入到：{{
          levels.find((level) => level.id === importLevel)?.name
        }}。已导入规格不会重复创建或覆盖；新规格需编辑并启用合作价。
      </p>
      <el-input
        v-model="importSearch"
        placeholder="搜索商城商品、规格或 ERP 编码"
        :disabled="saving"
        @keyup.enter="
          importPage = 1;
          loadImport();
        "
      />
      <el-button
        :disabled="saving"
        @click="
          importPage = 1;
          loadImport();
        "
        >查询</el-button
      >
      <el-table
        v-loading="importBusy"
        :data="importRows"
        row-key="id"
        @selection-change="importSelected = $event"
      >
        <el-table-column
          type="selection"
          width="45"
          :selectable="(row: any) => !row.imported && !saving"
        />
        <el-table-column prop="product.name" label="商城商品" min-width="180" />
        <el-table-column prop="specification" label="规格" min-width="180" />
        <el-table-column prop="erpSkuId" label="ERP 编码" min-width="150" />
        <el-table-column label="零售价"
          ><template #default="scope">{{
            money(scope.row.salePriceCents)
          }}</template></el-table-column
        >
        <el-table-column label="状态"
          ><template #default="scope">{{
            scope.row.imported
              ? "已导入"
              : scope.row.product.status === "PUBLISHED" && scope.row.enabled
                ? "可导入"
                : "商城未上架或规格停用"
          }}</template></el-table-column
        >
      </el-table>
      <el-pagination
        v-model:current-page="importPage"
        :page-size="30"
        :total="importTotal"
        :disabled="saving"
        layout="prev, pager, next, total"
        @current-change="loadImport"
      />
      <template #footer
        ><el-button :disabled="saving" @click="importDialog = false"
          >取消</el-button
        ><el-button
          type="primary"
          :loading="saving"
          :disabled="!importSelected.length || importBusy"
          @click="importProducts"
          >导入选中规格（{{ importSelected.length }}）</el-button
        ></template
      >
    </el-dialog>
    <el-dialog
      :model-value="!!ledgerDetail"
      title="资金登记日志"
      width="min(680px, 94vw)"
      @close="ledgerDetail = null"
    >
      <el-descriptions v-if="ledgerDetail" :column="1" border>
        <el-descriptions-item label="账户">{{
          ledgerDetail.account === "BALANCE" ? "消费余额" : "保证金"
        }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{
          ledgerLabels[ledgerDetail.type] || ledgerDetail.type
        }}</el-descriptions-item>
        <el-descriptions-item label="金额变动">{{
          money(ledgerDetail.deltaCents)
        }}</el-descriptions-item>
        <el-descriptions-item label="变动前余额">{{
          money(ledgerDetail.balanceBeforeCents)
        }}</el-descriptions-item>
        <el-descriptions-item label="变动后余额">{{
          money(ledgerDetail.balanceAfterCents)
        }}</el-descriptions-item>
        <el-descriptions-item label="操作人"
          >{{ ledgerDetail.operatorName || "系统 / 历史记录" }}
          {{ ledgerDetail.operatorUsername || "" }}</el-descriptions-item
        >
        <el-descriptions-item label="操作人 ID">{{
          ledgerDetail.actorId || "—"
        }}</el-descriptions-item>
        <el-descriptions-item label="登记原因">{{
          ledgerDetail.reason
        }}</el-descriptions-item>
        <el-descriptions-item label="凭证编号">{{
          ledgerDetail.referenceNo || "—"
        }}</el-descriptions-item>
        <el-descriptions-item label="登记时间">{{
          date(ledgerDetail.createdAt)
        }}</el-descriptions-item>
        <el-descriptions-item label="流水编号">{{
          ledgerDetail.id
        }}</el-descriptions-item>
        <el-descriptions-item label="审计编号">{{
          ledgerDetail.auditId || "—"
        }}</el-descriptions-item>
        <el-descriptions-item label="请求编号">{{
          ledgerDetail.requestId || "—"
        }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
    <el-dialog
      v-model="dialog"
      :title="
        {
          account: edit ? '编辑品牌伙伴' : '新增品牌伙伴',
          level: '合作等级',
          price: '设置合作价',
          deposit: '保证金登记',
          balance: '手动充值余额',
        }[dialogType]
      "
      width="560px"
      :close-on-click-modal="false"
      ><p v-if="dialogType === 'balance' || dialogType === 'deposit'">
        入账伙伴：<b>{{ selectedPartner?.name }}</b> ·
        {{ selectedPartner?.partnerNo }}
      </p>
      <el-form
        ref="accountForm"
        :model="form"
        :rules="accountRules"
        label-position="top"
        :disabled="saving || !!pendingFunds"
        ><template v-if="dialogType === 'account'"
          ><el-form-item v-if="!edit" label="登录账号" prop="username" required
            ><el-input v-model="form.username" maxlength="80" /></el-form-item
          ><el-form-item label="伙伴名称" prop="name" required
            ><el-input v-model="form.name" maxlength="80" /></el-form-item
          ><el-form-item label="联系方式" prop="mobile"
            ><el-input v-model="form.mobile" maxlength="30" /></el-form-item
          ><el-form-item label="合作等级" prop="levelId" required
            ><el-select v-model="form.levelId" style="width: 100%"
              ><el-option
                v-for="level in levels"
                :key="level.id"
                :label="level.name"
                :value="level.id"
                :disabled="!level.active" /></el-select></el-form-item
          ><el-form-item
            v-if="!edit"
            label="初始密码（10至128个字符）"
            prop="password"
            required
            ><el-input
              v-model="form.password"
              type="password"
              show-password
              autocomplete="new-password" /></el-form-item
          ><el-form-item v-if="edit" label="账户启用"
            ><el-switch v-model="form.active" /></el-form-item></template
        ><template v-else-if="dialogType === 'level'"
          ><el-form-item label="等级名称"
            ><el-input v-model="form.name" maxlength="40" /></el-form-item
          ><el-form-item label="排序"
            ><el-input-number
              v-model="form.sort"
              :min="0"
              :max="10000"
              :precision="0" /></el-form-item
          ><el-form-item label="启用"
            ><el-switch v-model="form.active" /></el-form-item></template
        ><template v-else-if="dialogType === 'price'"
          ><p>
            商城原商品：{{ edit?.sourceName || edit?.product.name }} ·
            {{ edit?.sourceSpecification || "默认规格" }}<br />
            ERP 规格编码：{{ edit?.erpSkuId }}（保持原绑定）
          </p>
          <el-form-item label="伙伴商品名称" required
            ><el-input v-model="form.productName" maxlength="200"
          /></el-form-item>
          <el-form-item label="伙伴规格名称"
            ><el-input v-model="form.specification" maxlength="300"
          /></el-form-item>
          <el-form-item label="伙伴零售价（元）"
            ><el-input-number
              v-model="form.retailAmount"
              :min="0"
              :max="21474836.47"
              :precision="2"
          /></el-form-item>
          <el-form-item label="合作价（元）"
            ><el-input-number
              v-model="form.amount"
              :min="0.01"
              :max="21474836.47"
              :precision="2" /></el-form-item
          ><el-form-item label="价格启用"
            ><el-switch v-model="form.enabled" /></el-form-item></template
        ><template v-else
          ><el-alert
            :title="
              dialogType === 'balance'
                ? '确认已收款后登记，入账后伙伴可用于采购。'
                : '保证金独立登记，不增加可消费余额。'
            "
            type="info"
            :closable="false" /><el-form-item
            v-if="dialogType === 'deposit'"
            label="登记类型"
            style="margin-top: 20px"
            ><el-select v-model="form.type"
              ><el-option label="收取" value="DEPOSIT_RECEIPT" /><el-option
                label="退还"
                value="DEPOSIT_RETURN" /><el-option
                label="更正（支持正负金额）"
                value="DEPOSIT_CORRECTION" /></el-select></el-form-item
          ><el-form-item label="金额（元）"
            ><el-input-number
              v-model="form.amount"
              :min="form.type === 'DEPOSIT_CORRECTION' ? -21474836.47 : 0.01"
              :max="21474836.47"
              :precision="2" /></el-form-item
          ><el-form-item label="登记原因" required
            ><el-input
              v-model="form.reason"
              type="textarea"
              maxlength="300" /></el-form-item
          ><el-form-item label="收款凭证编号（可选）"
            ><el-input
              v-model="form.referenceNo"
              maxlength="120"
              placeholder="银行流水号、收据编号等" /></el-form-item
          ><el-alert
            v-if="pendingFunds"
            title="上次登记结果尚未确认，请核对入账，勿重复新增。"
            type="warning"
            :closable="false" /></template></el-form
      ><template #footer
        ><el-button :disabled="saving" @click="dialog = false">取消</el-button
        ><el-button type="primary" :loading="saving" @click="save">{{
          pendingFunds
            ? "核对入账"
            : dialogType === "balance" || dialogType === "deposit"
              ? "确认登记"
              : "保存"
        }}</el-button></template
      ></el-dialog
    >
    <el-dialog
      :model-value="!!promotion"
      title="品牌伙伴专属推广"
      width="500px"
      @close="promotion = null"
      ><div v-if="promotion" class="promotion">
        <h2>{{ promotion.name }}</h2>
        <img
          :src="promotion.qrDataUrl"
          width="260"
          height="260"
          alt="品牌伙伴二维码"
        /><el-input :model-value="promotion.linkUrl" readonly /><el-button
          @click="copyPromotion"
          style="margin-top: 16px"
          >复制链接</el-button
        ><a
          :href="promotion.qrDataUrl"
          :download="`品牌伙伴-${promotion.partnerNo}.png`"
          ><el-button>下载二维码</el-button></a
        >
      </div></el-dialog
    >
  </section>
  <el-dialog
    v-model="memberDialog"
    title="绑定商城会员"
    width="min(580px,94vw)"
  >
    <p>{{ linkingPartner?.name }} · {{ linkingPartner?.username }}</p>
    <p v-if="linkingPartner?.linkedMember">
      当前绑定：{{ linkingPartner.linkedMember.nickname }} ·
      {{ linkingPartner.linkedMember.compatibilityId }}
    </p>
    <el-select
      v-model="linkedMemberId"
      filterable
      remote
      clearable
      :remote-method="searchMembers"
      :loading="memberBusy"
      placeholder="搜索会员名、会员编号、手机号或邮箱"
      style="width: 100%"
    >
      <el-option
        v-for="member in memberOptions"
        :key="member.id"
        :value="member.id"
        :label="`${member.nickname} · ${member.memberNo || member.compatibilityId || member.id} · ${member.mobile || member.phoneMasked || member.emailMasked || ''}`"
      />
    </el-select>
    <p class="muted">
      请绑定实际管理此合作账户的会员。清空并保存可解除绑定。会员推广归属不受此操作影响。
    </p>
    <template #footer
      ><el-button @click="memberDialog = false">取消</el-button
      ><el-button type="primary" :loading="saving" @click="saveMemberLink"
        >保存绑定</el-button
      ></template
    >
  </el-dialog>
</template>
<style scoped>
.page {
  padding: 28px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.head a {
  color: #236fbb;
  font-size: 14px;
}
.toolbar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.funds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 24px;
}
.funds h2 {
  margin: 18px 0 12px;
}
.promotion {
  text-align: center;
}
.el-pagination {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
</style>
