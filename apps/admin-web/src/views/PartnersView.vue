<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { canAdminResource } from "@saydian/app-contracts";
import { api, getAdminRoles, readableError, responseData } from "../api";
const route = useRoute(),
  resource = computed(() => route.path.slice(1)),
  levels = ref<any[]>([]),
  partners = ref<any[]>([]),
  prices = ref<any[]>([]),
  total = ref(0),
  page = ref(1),
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
  recharges = ref<any[]>([]);
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
  "partner-levels": "分销等级",
  "partner-prices": "等级分销价",
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
        page: resource.value === "partners" ? page.value : 1,
      },
    }),
  );
  partners.value = result.items;
  if (resource.value === "partners") total.value = result.total;
}
async function load() {
  loading.value = true;
  try {
    levels.value = responseData(await api.get("/partner-levels"));
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
            },
          }),
        );
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
    ElMessage.error(readableError(cause));
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function loadFinance() {
  funds.value = null;
  ledger.value = [];
  recharges.value = [];
  if (!partnerId.value) return;
  try {
    const [wallet, records, charges] = await Promise.all([
      api.get(`/partner-finance/${partnerId.value}/wallet`),
      api.get(`/partner-finance/${partnerId.value}/ledger`, {
        params: { page: page.value },
      }),
      api.get(`/partner-finance/${partnerId.value}/recharges`, {
        params: { page: page.value },
      }),
    ]);
    funds.value = responseData(wallet);
    ledger.value = responseData<any>(records).items;
    recharges.value = responseData<any>(charges).items;
    total.value =
      financeTab.value === "ledger"
        ? responseData<any>(records).total
        : responseData<any>(charges).total;
  } catch (cause) {
    ElMessage.error(readableError(cause));
  }
}
function open(type: string, row?: any) {
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
    });
  if (type === "deposit")
    Object.assign(form, {
      amount: 0,
      type: "DEPOSIT_RECEIPT",
      reason: "",
      idempotencyKey: crypto.randomUUID(),
    });
  dialog.value = true;
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (dialogType.value === "account") {
      if (edit.value)
        await api.patch(`/partners/${edit.value.id}`, { ...form });
      else await api.post("/partners", { ...form });
    } else if (dialogType.value === "level") {
      if (edit.value)
        await api.patch(`/partner-levels/${edit.value.id}`, { ...form });
      else await api.post("/partner-levels", { ...form });
    } else if (dialogType.value === "price") {
      await api.patch(`/partner-prices/${levelId.value}/${edit.value.id}`, {
        priceCents: Math.round(Number(form.amount) * 100),
        enabled: form.enabled,
        updatedAt: edit.value.price?.updatedAt ?? null,
      });
    } else {
      const amountCents = Math.round(Number(form.amount) * 100),
        deltaCents =
          form.type === "DEPOSIT_RETURN" ? -Math.abs(amountCents) : amountCents;
      await api.post(`/partner-finance/${partnerId.value}/deposit`, {
        deltaCents,
        type: form.type,
        reason: form.reason,
        idempotencyKey: form.idempotencyKey,
      });
    }
    ElMessage.success("已保存");
    dialog.value = false;
    await load();
  } catch (cause) {
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
        v-if="resource !== 'partner-levels' && resource !== 'partner-finance'"
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
      ><el-select
        v-if="resource === 'partner-finance'"
        v-model="partnerId"
        filterable
        remote
        :remote-method="loadPartners"
        placeholder="选择品牌伙伴"
        style="width: 360px"
        @change="
          page = 1;
          loadFinance();
        "
        ><el-option
          v-for="partner in partners"
          :key="partner.id"
          :value="partner.id"
          :label="`${partner.name} · ${partner.partnerNo}`" /></el-select
      ><el-button
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
        /><el-table-column label="分销等级" width="120"
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
            ></template
          ></el-table-column
        ></el-table
      >
      <el-table
        v-if="resource === 'partner-levels'"
        :data="levels"
        border
        stripe
        ><el-table-column prop="name" label="分销等级" /><el-table-column
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
      <el-table
        v-if="resource === 'partner-prices'"
        :data="prices"
        border
        stripe
        ><el-table-column label="商品" min-width="200"
          ><template #default="scope">{{
            scope.row.product.name
          }}</template></el-table-column
        ><el-table-column
          prop="specification"
          label="规格"
          min-width="140"
        /><el-table-column label="零售价" width="140"
          ><template #default="scope">{{
            money(scope.row.salePriceCents)
          }}</template></el-table-column
        ><el-table-column label="分销价" width="140"
          ><template #default="scope">{{
            money(scope.row.price?.priceCents)
          }}</template></el-table-column
        ><el-table-column label="采购状态" width="120"
          ><template #default="scope">{{
            scope.row.price?.enabled ? "价格已启用" : "暂不可采购"
          }}</template></el-table-column
        ><el-table-column v-if="canPrice" label="操作" width="120"
          ><template #default="scope"
            ><el-button @click="open('price', scope.row)"
              >设置分销价</el-button
            ></template
          ></el-table-column
        ></el-table
      >
      <template v-if="resource === 'partner-finance'"
        ><el-empty
          v-if="!funds"
          description="请选择品牌伙伴查询资金"
        /><template v-else
          ><div class="funds">
            <el-card
              ><span class="muted">可消费余额</span>
              <h2>{{ money(funds.balanceCents) }}</h2></el-card
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
              label="充值记录"
              name="recharges" /></el-tabs
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
            ><el-table-column label="账户余额" width="140"
              ><template #default="scope">{{
                money(scope.row.balanceAfterCents)
              }}</template></el-table-column
            ><el-table-column
              prop="reason"
              label="说明"
              min-width="220"
            /><el-table-column label="时间" min-width="180"
              ><template #default="scope">{{
                date(scope.row.createdAt)
              }}</template></el-table-column
            ></el-table
          ><el-table v-else :data="recharges" border stripe
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
          ></template
        ></template
      >
      <el-pagination
        v-if="resource !== 'partner-levels'"
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="
          resource === 'partner-finance' ? loadFinance() : load()
        "
      />
    </div>
    <el-dialog
      v-model="dialog"
      :title="
        {
          account: edit ? '编辑品牌伙伴' : '新增品牌伙伴',
          level: '分销等级',
          price: '设置分销价',
          deposit: '保证金登记',
        }[dialogType]
      "
      width="560px"
      :close-on-click-modal="false"
      ><el-form label-position="top" :disabled="saving"
        ><template v-if="dialogType === 'account'"
          ><el-form-item v-if="!edit" label="登录账号"
            ><el-input v-model="form.username" maxlength="80" /></el-form-item
          ><el-form-item label="伙伴名称"
            ><el-input v-model="form.name" maxlength="80" /></el-form-item
          ><el-form-item label="联系方式"
            ><el-input v-model="form.mobile" maxlength="30" /></el-form-item
          ><el-form-item label="分销等级"
            ><el-select v-model="form.levelId" style="width: 100%"
              ><el-option
                v-for="level in levels"
                :key="level.id"
                :label="level.name"
                :value="level.id"
                :disabled="!level.active" /></el-select></el-form-item
          ><el-form-item v-if="!edit" label="初始密码（至少10个字符）"
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
            {{ edit?.product.name }} · {{ edit?.specification || "默认规格" }}
          </p>
          <el-form-item label="分销价（元）"
            ><el-input-number
              v-model="form.amount"
              :min="0.01"
              :max="21474836.47"
              :precision="2" /></el-form-item
          ><el-form-item label="价格启用"
            ><el-switch v-model="form.enabled" /></el-form-item></template
        ><template v-else
          ><el-alert
            title="保证金独立登记，不增加可消费余额。"
            type="info"
            :closable="false" /><el-form-item
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
          ><el-form-item label="登记原因"
            ><el-input
              v-model="form.reason"
              type="textarea"
              maxlength="300" /></el-form-item></template></el-form
      ><template #footer
        ><el-button :disabled="saving" @click="dialog = false">取消</el-button
        ><el-button type="primary" :loading="saving" @click="save"
          >保存</el-button
        ></template
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
  margin-top: 20px;
}
</style>
