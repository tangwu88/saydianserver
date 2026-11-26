<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import axios from "axios";
import { parseGiftCardNos } from "@saydian/app-contracts";

type Result = { cardNo: string; status: string; orderNo: string | null };
const client = axios.create({
  baseURL: "/api/saydian-app/gift-query/v1",
  timeout: 20_000,
});
// Separate identity and storage namespace; never borrow an admin/member token.
const storageKey = "saydian-gift-query-session";
const token = ref(sessionStorage.getItem(storageKey) || "");
const username = ref(""),
  password = ref(""),
  name = ref("");
const authenticated = ref(false),
  checking = ref(true),
  busy = ref(false),
  error = ref("");
const input = ref(""),
  items = ref<Result[]>([]),
  queriedAt = ref("");
const labels: Record<string, string> = {
  REDEEMED: "已兑换",
  NOT_REDEEMED: "未兑换",
  NOT_FOUND: "卡号不存在",
};
let generation = 0,
  disposed = false;
function clear() {
  generation++;
  authenticated.value = false;
  token.value = "";
  name.value = "";
  sessionStorage.removeItem(storageKey);
  input.value = "";
  items.value = [];
  queriedAt.value = "";
  password.value = "";
}
const headers = () => ({ Authorization: `Bearer ${token.value}` });
function failure(cause: unknown) {
  if (axios.isAxiosError(cause) && cause.response?.status === 401) clear();
  error.value = axios.isAxiosError(cause)
    ? cause.response?.data?.message || "网络连接失败，请重试"
    : cause instanceof Error
      ? cause.message
      : "请求失败，请重试";
}
async function login() {
  if (busy.value || checking.value) return;
  error.value = "";
  busy.value = true;
  const current = ++generation;
  try {
    const response = await client.post("/login", {
      username: username.value.trim(),
      password: password.value,
    });
    if (disposed || current !== generation) return;
    const data = response.data.data;
    token.value = data.token;
    sessionStorage.setItem(storageKey, data.token);
    name.value = data.displayName;
    authenticated.value = true;
  } catch (cause) {
    if (!disposed && current === generation) failure(cause);
  } finally {
    password.value = "";
    if (!disposed) busy.value = false;
  }
}
async function query() {
  if (busy.value || !authenticated.value) return;
  items.value = [];
  queriedAt.value = "";
  error.value = "";
  let cardNos: string[];
  try {
    cardNos = parseGiftCardNos(input.value);
  } catch {
    error.value = "请输入8开头的8位卡号，例如80100611；去重后每次最多100张";
    return;
  }
  busy.value = true;
  const current = ++generation;
  try {
    const response = await client.post(
      "/query",
      { cardNos },
      { headers: headers() },
    );
    if (disposed || current !== generation) return;
    items.value = response.data.data.items;
    queriedAt.value = response.data.data.queriedAt;
  } catch (cause) {
    if (!disposed && current === generation) failure(cause);
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function logout() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await client.post("/logout", {}, { headers: headers() });
    clear();
  } catch (cause) {
    if (!disposed) failure(cause);
  } finally {
    if (!disposed) busy.value = false;
  }
}
onMounted(async () => {
  if (!token.value) {
    checking.value = false;
    return;
  }
  const current = generation;
  try {
    const response = await client.get("/me", { headers: headers() });
    if (disposed || current !== generation) return;
    name.value = response.data.data.displayName;
    authenticated.value = true;
  } catch (cause) {
    if (!disposed && current === generation) failure(cause);
  } finally {
    if (!disposed) checking.value = false;
  }
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  password.value = "";
  items.value = [];
});
</script>

<template>
  <main class="gift-query-page">
    <header>
      <span class="brand">SAYDIAN 赛电</span>
      <h1>礼品卡兑换查询</h1>
      <p>批量核对兑换状态与对应订单编号</p>
    </header>
    <el-card v-if="checking" shadow="never">正在检查登录状态…</el-card>
    <el-card v-else-if="!authenticated" class="login-card" shadow="never">
      <h2>账号登录</h2>
      <p>请使用发卡方提供的查询账号</p>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="账号"
          ><el-input
            v-model="username"
            maxlength="64"
            autocomplete="username"
            :disabled="busy"
        /></el-form-item>
        <el-form-item label="密码"
          ><el-input
            v-model="password"
            type="password"
            show-password
            maxlength="72"
            autocomplete="current-password"
            :disabled="busy"
        /></el-form-item>
        <el-button type="primary" native-type="submit" :loading="busy"
          >登录查询</el-button
        >
      </el-form>
    </el-card>
    <el-card v-else shadow="never">
      <div class="account">
        <span>当前账号：{{ name }}</span
        ><el-button :disabled="busy" @click="logout">退出登录</el-button>
      </div>
      <el-form label-position="top" @submit.prevent="query">
        <el-form-item label="兑换卡号"
          ><el-input
            v-model="input"
            type="textarea"
            :rows="7"
            maxlength="10000"
            :disabled="busy"
            placeholder="例如：80100611&#10;多个卡号可换行，或用逗号、空格分隔；去重后最多100张"
        /></el-form-item>
        <el-button type="primary" native-type="submit" :loading="busy"
          >批量查询</el-button
        >
      </el-form>
      <template v-if="items.length">
        <div class="summary">
          共 {{ items.length }} 张 · 已兑换
          {{ items.filter((row) => row.status === "REDEEMED").length }} 张 ·
          未兑换
          {{ items.filter((row) => row.status === "NOT_REDEEMED").length }} 张 ·
          不存在
          {{ items.filter((row) => row.status === "NOT_FOUND").length }} 张
        </div>
        <small
          >查询时间：{{
            new Date(queriedAt).toLocaleString()
          }}。结果为本次查询时的状态。</small
        >
        <el-table :data="items" border class="results"
          ><el-table-column
            prop="cardNo"
            label="卡号"
            min-width="125"
          /><el-table-column label="兑换状态" min-width="120"
            ><template #default="{ row }"
              ><span
                class="result-state"
                :class="{ redeemed: row.status === 'REDEEMED' }"
                >{{ labels[row.status] }}</span
              ></template
            ></el-table-column
          ><el-table-column label="对应订单编号" min-width="220"
            ><template #default="{ row }">{{
              row.orderNo || "—"
            }}</template></el-table-column
          ></el-table
        >
        <ul class="mobile-results" aria-label="查询结果">
          <li v-for="row in items" :key="row.cardNo">
            <div>
              <strong>{{ row.cardNo }}</strong
              ><span
                class="result-state"
                :class="{ redeemed: row.status === 'REDEEMED' }"
                >{{ labels[row.status] }}</span
              >
            </div>
            <p>
              订单编号：<span>{{ row.orderNo || "—" }}</span>
            </p>
          </li>
        </ul>
      </template>
    </el-card>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
      class="error"
    />
  </main>
</template>

<style scoped>
.gift-query-page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 36px 18px 64px;
  color: #24364a;
}
header {
  margin-bottom: 26px;
}
.brand {
  font-weight: 700;
  letter-spacing: 2px;
  color: #167570;
}
h1 {
  font-size: 28px;
  margin: 18px 0 10px;
}
h2 {
  margin-top: 0;
}
p,
small {
  color: #65758a;
}
.login-card {
  max-width: 440px;
  margin: 0 auto;
}
.account {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}
.summary {
  margin: 24px 0 8px;
  font-weight: 600;
}
.results {
  margin-top: 16px;
}
.result-state {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 5px;
  background: #eff2f6;
  color: #526277;
  font-size: 13px;
  line-height: 1.6;
  white-space: nowrap;
}
.result-state.redeemed {
  background: #e5f5ee;
  color: #1c7255;
}
.mobile-results {
  display: none;
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
}
.mobile-results li {
  padding: 14px 0;
  border-top: 1px solid #e4e9ef;
}
.mobile-results li > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.mobile-results p {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.7;
}
.mobile-results p span {
  color: #24364a;
  overflow-wrap: anywhere;
  user-select: text;
}
@media (max-width: 640px) {
  .results {
    display: none;
  }
  .mobile-results {
    display: block;
  }
}
.error {
  margin-top: 18px;
}
</style>
