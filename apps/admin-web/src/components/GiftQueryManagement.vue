<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  api,
  adminSessionKey,
  getAdminRoles,
  readableError,
  responseData,
} from "../api";
type Account = {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  version: number;
  queryCount: number;
  failedCount: number;
  cardCount: number;
  redeemedCount: number;
  lastQueryAt: string | null;
};
type Log = {
  id: string;
  accountId: string;
  username: string;
  outcome: string;
  cardCount: number;
  redeemedCount: number;
  missingCount: number;
  createdAt: string;
  results: { cardNo: string; status: string; orderNo: string | null }[];
};
const authorized = computed(() => getAdminRoles().includes("SUPER_ADMIN"));
const accounts = ref<Account[]>([]),
  logs = ref<Log[]>([]),
  total = ref(0),
  page = ref(1),
  accountId = ref("");
const loading = ref(false),
  busy = ref(false),
  error = ref(""),
  dialog = ref(false),
  detail = ref<Log | null>(null);
const form = ref({
  id: "",
  version: 0,
  username: "",
  displayName: "",
  password: "",
  active: true,
});
const portalUrl = new URL(
  `${import.meta.env.BASE_URL}gift-query`,
  location.origin,
).href;
const labels: Record<string, string> = {
  REDEEMED: "已兑换",
  NOT_REDEEMED: "未兑换",
  NOT_FOUND: "卡号不存在",
};
const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
let generation = 0,
  disposed = false;
function owned(session: string | null, current: number) {
  return (
    !disposed &&
    session === adminSessionKey() &&
    generation === current &&
    authorized.value
  );
}
async function load() {
  if (!authorized.value) return;
  const current = ++generation,
    session = adminSessionKey();
  loading.value = true;
  error.value = "";
  accounts.value = [];
  logs.value = [];
  detail.value = null;
  try {
    const [a, l] = await Promise.all([
      api.get("/commerce-gift-query-accounts"),
      api.get("/commerce-gift-query-logs", {
        params: { accountId: accountId.value, page: page.value },
      }),
    ]);
    if (!owned(session, current)) return;
    accounts.value = responseData<Account[]>(a);
    const result = responseData<{ items: Log[]; total: number }>(l);
    logs.value = result.items;
    total.value = result.total;
  } catch (cause) {
    if (owned(session, current)) error.value = readableError(cause);
  } finally {
    if (!disposed && current === generation) loading.value = false;
  }
}
function edit(account?: Account) {
  form.value = {
    id: account?.id || "",
    version: account?.version || 0,
    username: account?.username || "",
    displayName: account?.displayName || "",
    password: "",
    active: account?.active ?? true,
  };
  dialog.value = true;
  error.value = "";
}
async function save() {
  if (busy.value || !authorized.value) return;
  if (
    !form.value.displayName.trim() ||
    (!form.value.id &&
      !/^[a-zA-Z0-9_-]{3,64}$/.test(form.value.username.trim()))
  ) {
    error.value = "请填写名称与3至64位字母、数字、下划线或短横线组成的账号";
    return;
  }
  if (
    (!form.value.id || form.value.password) &&
    (form.value.password.length < 10 ||
      new TextEncoder().encode(form.value.password).length > 72)
  ) {
    error.value = "密码至少10个字符，最多72字节";
    return;
  }
  busy.value = true;
  error.value = "";
  const current = generation,
    session = adminSessionKey();
  const { id, ...body } = form.value;
  try {
    if (id) await api.put(`/commerce-gift-query-accounts/${id}`, body);
    else await api.post("/commerce-gift-query-accounts", body);
    if (!owned(session, current)) return;
    form.value.password = "";
    dialog.value = false;
    await load();
  } catch (cause) {
    if (owned(session, current)) error.value = readableError(cause);
  } finally {
    if (!disposed) busy.value = false;
  }
}
function filterLogs(id: string) {
  accountId.value = id;
  page.value = 1;
  void load();
}
onMounted(load);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  form.value.password = "";
  accounts.value = [];
  logs.value = [];
  detail.value = null;
});
</script>

<template>
  <section v-if="authorized" v-loading="loading" class="query-management">
    <div class="query-heading">
      <div>
        <h2>独立查询页面</h2>
        <a :href="portalUrl" target="_blank" rel="noopener noreferrer">{{
          portalUrl
        }}</a>
      </div>
      <el-button :disabled="busy || loading" @click="load"
        >刷新账号与日志</el-button
      >
    </div>
    <p>
      查询账号仅可查看卡号兑换状态和订单编号。编辑账号后已有登录失效；密码仅在设置时填写，不支持查看原密码。
    </p>
    <el-alert
      v-if="error && !dialog"
      :title="error"
      type="error"
      :closable="false"
      show-icon
    />
    <div class="query-heading">
      <h3>查询账号与累计统计</h3>
      <el-button
        type="primary"
        :disabled="busy || loading || accounts.length >= 100"
        @click="edit()"
        >新增查询账号</el-button
      >
    </div>
    <el-table :data="accounts" border>
      <el-table-column
        prop="username"
        label="账号"
        min-width="130"
      /><el-table-column prop="displayName" label="名称" min-width="130" />
      <el-table-column label="状态" width="85"
        ><template #default="{ row }">{{
          row.active ? "启用" : "停用"
        }}</template></el-table-column
      >
      <el-table-column
        prop="queryCount"
        label="查询次数"
        width="95"
      /><el-table-column
        prop="failedCount"
        label="无效请求"
        width="95"
      /><el-table-column
        prop="cardCount"
        label="累计查卡"
        width="95"
      /><el-table-column prop="redeemedCount" label="查到已兑换" width="110" />
      <el-table-column label="最近查询" min-width="175"
        ><template #default="{ row }">{{
          stamp(row.lastQueryAt)
        }}</template></el-table-column
      >
      <el-table-column label="操作" width="180"
        ><template #default="{ row }"
          ><el-button link :disabled="busy || loading" @click="edit(row)"
            >编辑 / 重设密码</el-button
          ><el-button link @click="filterLogs(row.id)"
            >日志</el-button
          ></template
        ></el-table-column
      >
    </el-table>
    <h3>查询日志</h3>
    <p>
      每次成功查询保存当时结果；累计查卡按每次去重后的卡数累加。同一卡号多次查询会重复计数。无效格式的接口请求记为无效请求，不计查卡数。
    </p>
    <el-select
      v-model="accountId"
      clearable
      placeholder="全部查询账号"
      @change="filterLogs(accountId)"
      ><el-option
        v-for="account in accounts"
        :key="account.id"
        :label="`${account.displayName}（${account.username}）`"
        :value="account.id"
    /></el-select>
    <el-table :data="logs" border class="query-logs">
      <el-table-column label="查询时间" min-width="180"
        ><template #default="{ row }">{{
          stamp(row.createdAt)
        }}</template></el-table-column
      ><el-table-column prop="username" label="账号" min-width="125" />
      <el-table-column label="结果" width="110"
        ><template #default="{ row }">{{
          row.outcome === "SUCCESS" ? "查询成功" : "格式无效"
        }}</template></el-table-column
      ><el-table-column
        prop="cardCount"
        label="卡数"
        width="70"
      /><el-table-column
        prop="redeemedCount"
        label="已兑换"
        width="85"
      /><el-table-column prop="missingCount" label="不存在" width="85" />
      <el-table-column label="未兑换" width="85"
        ><template #default="{ row }">{{
          row.cardCount - row.redeemedCount - row.missingCount
        }}</template></el-table-column
      ><el-table-column label="操作" width="95"
        ><template #default="{ row }"
          ><el-button link @click="detail = row">查看明细</el-button></template
        ></el-table-column
      >
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="30"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
    <el-dialog
      v-model="dialog"
      :title="form.id ? '编辑查询账号' : '新增查询账号'"
      width="min(520px, 94vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      @closed="form.password = ''"
    >
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-form label-position="top" @submit.prevent="save"
        ><el-form-item label="账号"
          ><el-input
            v-model="form.username"
            :disabled="!!form.id || busy"
            maxlength="64"
            autocomplete="off" /></el-form-item
        ><el-form-item label="名称"
          ><el-input
            v-model="form.displayName"
            :disabled="busy"
            maxlength="80" /></el-form-item
        ><el-form-item
          :label="form.id ? '新密码（不修改请留空）' : '密码（至少10个字符）'"
          ><el-input
            v-model="form.password"
            :disabled="busy"
            type="password"
            show-password
            autocomplete="new-password"
            maxlength="72" /></el-form-item
        ><el-form-item label="启用"
          ><el-switch v-model="form.active" :disabled="busy" /></el-form-item
        ><el-button type="primary" native-type="submit" :loading="busy"
          >保存</el-button
        ></el-form
      >
    </el-dialog>
    <el-dialog
      :model-value="!!detail"
      title="查询明细（查询当时的状态）"
      width="min(760px, 96vw)"
      @close="detail = null"
      ><template v-if="detail"
        ><p>{{ detail.username }} · {{ stamp(detail.createdAt) }}</p>
        <el-table :data="detail.results" border
          ><el-table-column prop="cardNo" label="卡号" /><el-table-column
            label="状态"
            ><template #default="{ row }">{{
              labels[row.status]
            }}</template></el-table-column
          ><el-table-column label="订单编号" min-width="200"
            ><template #default="{ row }">{{
              row.orderNo || "—"
            }}</template></el-table-column
          ></el-table
        ></template
      ></el-dialog
    >
  </section>
</template>

<style scoped>
.query-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin: 18px 0;
}
h2,
h3 {
  margin: 0;
}
p {
  color: #65758a;
  line-height: 1.7;
}
a {
  overflow-wrap: anywhere;
}
.query-logs {
  margin: 14px 0;
}
</style>
