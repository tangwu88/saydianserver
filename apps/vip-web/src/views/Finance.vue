<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Refresh, Wallet, Lock, CreditCard } from "@element-plus/icons-vue";
import { api, data, errorMessage, requestKey } from "../api";
import { date, ledgerTypes, money, statuses } from "../present";
import {
  readRecharge,
  saveRecharge,
  clearRecharge,
  terminalPayment,
  channelLabel,
} from "../recharge-recovery";
import type { RechargeInput } from "../recharge-recovery";
import PageError from "../components/PageError.vue";
import EmptyState from "../components/EmptyState.vue";
const route = useRoute(),
  router = useRouter();
const depositMode = computed(() => route.path === "/deposit"),
  ledgerMode = computed(() => route.path === "/ledger");
const wallet = ref<any>(),
  ledger = ref<any[]>([]),
  recharges = ref<any[]>([]),
  page = ref(1),
  total = ref(0),
  account = ref("BALANCE"),
  capabilities = ref<any[]>([]),
  busy = ref(false),
  paying = ref(false),
  error = ref(""),
  paymentError = ref(""),
  pollError = ref(""),
  pollBusy = ref(false);
const selectedRechargeId = ref("");
const form = reactive({ amount: 100, channel: "wechat_native" }),
  payment = ref<any>(),
  currentRecharge = ref<any>(),
  payDialog = ref(false),
  pendingInput = ref<RechargeInput | null>(null);
const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const channels = computed(() =>
  capabilities.value.filter(
    (item) =>
      item.channel === "wechat_native" ||
      item.channel === (mobile ? "alipay_wap" : "alipay_page") ||
      item.channel === pendingInput.value?.channel,
  ),
);
const title = computed(() =>
  depositMode.value ? "保证金" : ledgerMode.value ? "收支明细" : "余额充值",
);
const paymentStatus = computed(() =>
  String(
    payment.value?.status || currentRecharge.value?.status || "",
  ).toLowerCase(),
);
let partnerId = "",
  key: string = requestKey(),
  timer: ReturnType<typeof setInterval> | undefined,
  generation = 0,
  listRequest = 0,
  paymentRequest = 0;
function stopPolling() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
onBeforeUnmount(() => {
  generation++;
  listRequest++;
  paymentRequest++;
  stopPolling();
});
async function load() {
  const request = ++listRequest,
    view = generation;
  busy.value = true;
  error.value = "";
  try {
    const funds = data(await api.get("/wallet"));
    if (view !== generation || request !== listRequest) return;
    wallet.value = funds;
    partnerId = funds.partnerId;
    pendingInput.value = readRecharge(sessionStorage, partnerId);
    if (pendingInput.value) {
      form.amount = pendingInput.value.amountCents / 100;
      form.channel = pendingInput.value.channel;
      key = pendingInput.value.idempotencyKey;
    }
    if (depositMode.value || ledgerMode.value) {
      const result = data(
        await api.get("/ledger", {
          params: {
            account: depositMode.value ? "DEPOSIT" : account.value,
            page: page.value,
          },
        }),
      );
      if (view === generation && request === listRequest) {
        ledger.value = result.items;
        total.value = result.total;
      }
    } else {
      const [records, caps] = await Promise.all([
        api.get("/recharges", { params: { page: page.value } }),
        api.get("/payment-capabilities"),
      ]);
      if (view !== generation || request !== listRequest) return;
      recharges.value = data(records).items;
      total.value = data(records).total;
      capabilities.value = data(caps).items;
      const enabled = channels.value.filter((item) => item.enabled);
      if (
        !pendingInput.value &&
        !enabled.some((item) => item.channel === form.channel)
      )
        form.channel = enabled[0]?.channel || "";
      if (
        mobile &&
        !pendingInput.value &&
        enabled.some((item) => item.channel === "alipay_wap")
      )
        form.channel = "alipay_wap";
    }
  } catch (cause) {
    if (view === generation && request === listRequest)
      error.value = errorMessage(cause);
  } finally {
    if (view === generation && request === listRequest) busy.value = false;
  }
}
watch(
  () => route.path,
  async () => {
    const view = ++generation;
    paymentRequest++;
    stopPolling();
    payDialog.value = false;
    payment.value = null;
    currentRecharge.value = null;
    paymentError.value = "";
    page.value = 1;
    ledger.value = [];
    recharges.value = [];
    await load();
    if (view === generation && route.params.id)
      await viewRecharge(String(route.params.id));
  },
  { immediate: true },
);
function completedInput(recharge: any) {
  const pending = pendingInput.value;
  if (
    pending &&
    recharge.idempotencyKey ===
      `partner-recharge-request:${partnerId}:${pending.idempotencyKey}`
  ) {
    clearRecharge(sessionStorage, partnerId, pending.idempotencyKey);
    pendingInput.value = null;
    key = requestKey();
  }
}
async function create() {
  if (paying.value || !partnerId) return;
  const amountCents = Math.round(Number(form.amount) * 100);
  if (
    !pendingInput.value &&
    (!Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > 2147483647)
  ) {
    paymentError.value = "请输入有效的充值金额";
    return;
  }
  if (
    !pendingInput.value &&
    !channels.value.some(
      (item) => item.channel === form.channel && item.enabled,
    )
  )
    return;
  paying.value = true;
  paymentError.value = "";
  const view = generation;
  try {
    const input = pendingInput.value ?? {
      amountCents,
      channel: form.channel,
      idempotencyKey: key,
    };
    try {
      saveRecharge(sessionStorage, partnerId, input);
    } catch {
      paymentError.value = "浏览器无法保存充值状态，请允许本站存储后重试";
      return;
    }
    pendingInput.value = input;
    const recharge = data(await api.post("/recharges", input));
    completedInput(recharge);
    if (view !== generation) return;
    currentRecharge.value = recharge;
    payment.value = recharge.payment;
    payDialog.value = true;
    pollError.value = "";
    startPolling();
    await load();
  } catch (cause) {
    if (view === generation) {
      paymentError.value = errorMessage(cause);
      await load();
    }
  } finally {
    paying.value = false;
  }
}
async function viewRecharge(id: string) {
  selectedRechargeId.value = id;
  const request = ++paymentRequest,
    view = generation;
  stopPolling();
  currentRecharge.value = null;
  payment.value = null;
  pollError.value = "";
  payDialog.value = true;
  try {
    const recharge = data(await api.get(`/recharges/${id}`));
    if (request !== paymentRequest || view !== generation) return;
    completedInput(recharge);
    currentRecharge.value = recharge;
    payment.value = recharge.payment;
    startPolling();
  } catch (cause) {
    if (request === paymentRequest && view === generation)
      pollError.value = errorMessage(cause);
  }
}
async function resume() {
  if (!currentRecharge.value || paying.value) return;
  paying.value = true;
  const id = currentRecharge.value.id,
    view = generation;
  try {
    const result = data(await api.post(`/recharges/${id}/payment`));
    if (view !== generation || id !== currentRecharge.value?.id) return;
    payment.value = result;
    pollError.value = "";
    startPolling();
  } catch (cause) {
    if (view === generation) pollError.value = errorMessage(cause);
  } finally {
    paying.value = false;
  }
}
function startPolling() {
  stopPolling();
  if (!currentRecharge.value || terminalPayment(paymentStatus.value)) return;
  timer = setInterval(() => void poll(), 4000);
}
async function poll() {
  if (!currentRecharge.value || pollBusy.value) return;
  pollBusy.value = true;
  const id = currentRecharge.value.id,
    view = generation;
  try {
    const result = data(await api.get(`/recharges/${id}`));
    if (view !== generation || id !== currentRecharge.value?.id) return;
    currentRecharge.value = result;
    payment.value = result.payment;
    pollError.value = "";
    if (terminalPayment(paymentStatus.value)) {
      stopPolling();
      if (paymentStatus.value === "succeeded") {
        ElMessage.success("充值已到账");
        await load();
      }
    } else if (payDialog.value && !timer) startPolling();
  } catch (cause) {
    if (view === generation && id === currentRecharge.value?.id) {
      stopPolling();
      pollError.value = errorMessage(cause);
    }
  } finally {
    pollBusy.value = false;
  }
}
function invokeAlipay() {
  const invoke = payment.value?.invoke;
  try {
    const url = new URL(invoke?.url || "");
    if (
      invoke?.type !== "FORM" ||
      url.protocol !== "https:" ||
      ![
        "openapi.alipay.com",
        "openapi-sandbox.dl.alipaydev.com",
        "openapi.alipaydev.com",
      ].includes(url.hostname) ||
      url.pathname !== "/gateway.do" ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error();
    const formElement = document.createElement("form");
    formElement.method = "POST";
    formElement.action = url.toString();
    formElement.target = "_blank";
    formElement.rel = "noopener noreferrer";
    Object.entries(invoke.fields || {}).forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = String(value);
      formElement.appendChild(input);
    });
    document.body.appendChild(formElement);
    formElement.submit();
    formElement.remove();
  } catch {
    pollError.value = "支付页面暂不可用，请刷新充值状态";
  }
}
function closePayment() {
  stopPolling();
  paymentRequest++;
  if (route.params.id) void router.replace("/wallet");
}
</script>
<template>
  <section class="page" v-loading="busy">
    <div class="page-head">
      <h1>{{ title }}</h1>
      <el-button :icon="Refresh" :loading="busy" @click="load">刷新</el-button>
    </div>
    <PageError :message="error" @retry="load" />
    <div class="funds">
      <article class="panel">
        <span class="muted"
          ><el-icon><Wallet /></el-icon>可用余额</span
        ><strong>{{ money(wallet?.balanceCents) }}</strong
        ><router-link :to="ledgerMode ? '/wallet' : '/ledger'">{{
          ledgerMode ? "余额充值" : "收支明细"
        }}</router-link>
      </article>
      <article class="panel">
        <span class="muted"
          ><el-icon><Lock /></el-icon>保证金</span
        ><strong>{{ money(wallet?.depositCents) }}</strong
        ><router-link v-if="!depositMode" to="/deposit">查看记录</router-link
        ><small v-else>由管理员登记，不用于采购</small>
      </article>
    </div>
    <div v-if="!depositMode && !ledgerMode" class="panel">
      <h2>充值金额</h2>
      <el-alert
        v-if="pendingInput"
        title="上次充值结果待确认，请继续核对，避免重复充值。"
        type="warning"
        :closable="false"
        class="section-space"
      />
      <div class="amount-options">
        <el-button
          v-for="amount in [100, 500, 1000, 3000]"
          :key="amount"
          :type="form.amount === amount ? 'primary' : 'default'"
          :plain="form.amount !== amount"
          :disabled="paying || !!pendingInput"
          @click="form.amount = amount"
          >{{ money(amount * 100) }}</el-button
        >
      </div>
      <el-form label-position="top" :disabled="paying || !!pendingInput"
        ><el-form-item label="自定义金额（元）"
          ><el-input-number
            v-model="form.amount"
            :min="0.01"
            :max="21474836.47"
            :precision="2"
            :controls="false" /></el-form-item
        ><el-form-item label="支付方式"
          ><el-radio-group v-model="form.channel" class="channel-options"
            ><el-radio-button
              v-for="item in channels"
              :key="item.channel"
              :value="item.channel"
              :disabled="!item.enabled"
              >{{ channelLabel(item.channel)
              }}{{ item.enabled ? "" : "（暂不可用）" }}</el-radio-button
            ></el-radio-group
          ></el-form-item
        ></el-form
      >
      <el-alert
        v-if="!busy && !channels.some((item) => item.enabled)"
        title="在线充值暂不可用，请联系管理员。"
        type="info"
        :closable="false"
        class="section-space"
      />
      <p v-if="paymentError" class="inline-error" role="alert">
        {{ paymentError }}
      </p>
      <el-button
        type="primary"
        size="large"
        :icon="CreditCard"
        :loading="paying"
        :disabled="
          !partnerId ||
          (!pendingInput &&
            !channels.some(
              (item) => item.channel === form.channel && item.enabled,
            ))
        "
        @click="create"
        >{{ pendingInput ? "核对上次充值" : "去付款" }}</el-button
      >
    </div>
    <div class="panel">
      <div class="records-heading">
        <h2>
          {{
            depositMode ? "保证金记录" : ledgerMode ? "收支记录" : "充值记录"
          }}
        </h2>
        <el-radio-group
          v-if="ledgerMode"
          v-model="account"
          @change="
            page = 1;
            load();
          "
          ><el-radio-button value="BALANCE">余额</el-radio-button
          ><el-radio-button value="DEPOSIT"
            >保证金</el-radio-button
          ></el-radio-group
        >
      </div>
      <template v-if="depositMode || ledgerMode"
        ><EmptyState
          v-if="!ledger.length && !busy && !error"
          :title="depositMode ? '暂无保证金记录' : '暂无收支记录'"
        />
        <article v-for="record in ledger" :key="record.id" class="record-card">
          <div class="record-head">
            <div>
              <b>{{ ledgerTypes[record.type] || record.type }}</b
              ><small>{{ date(record.createdAt) }}</small>
            </div>
            <strong :class="record.deltaCents > 0 ? 'positive' : 'price'"
              >{{ record.deltaCents > 0 ? "+" : ""
              }}{{ money(record.deltaCents) }}</strong
            >
          </div>
          <p class="record-reason">{{ record.reason }}</p>
          <div class="muted record-number">
            {{ record.account === "DEPOSIT" ? "保证金" : "余额" }}：{{
              money(record.balanceAfterCents)
            }}
          </div>
        </article></template
      >
      <template v-else
        ><EmptyState
          v-if="!recharges.length && !busy && !error"
          title="暂无在线充值记录"
        />
        <article
          v-for="recharge in recharges"
          :key="recharge.id"
          class="record-card"
        >
          <div class="record-head">
            <div>
              <b>{{ channelLabel(recharge.channel) }}充值</b
              ><small>{{ date(recharge.createdAt) }}</small>
            </div>
            <el-tag
              :type="recharge.status === 'SUCCEEDED' ? 'success' : 'info'"
              >{{ statuses[recharge.status] || recharge.status }}</el-tag
            >
          </div>
          <div class="record-number muted">{{ recharge.rechargeNo }}</div>
          <div class="record-foot">
            <strong>{{ money(recharge.amountCents) }}</strong
            ><el-button
              type="primary"
              plain
              @click="viewRecharge(recharge.id)"
              >{{
                ["CREATED", "PENDING"].includes(recharge.status)
                  ? "查看 / 继续付款"
                  : "查看详情"
              }}</el-button
            >
          </div>
        </article></template
      >
      <el-pagination
        v-if="total > 30"
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
    <el-dialog
      v-model="payDialog"
      title="充值付款"
      width="520px"
      @closed="closePayment"
      ><PageError
        :message="pollError"
        @retry="
          currentRecharge ? poll() : viewRecharge(String(route.params.id || ''))
        "
      />
      <div v-if="currentRecharge" class="payment">
        <strong>{{ money(currentRecharge.amountCents) }}</strong>
        <p class="record-number muted">{{ currentRecharge.rechargeNo }}</p>
        <el-result
          v-if="paymentStatus === 'succeeded'"
          icon="success"
          title="充值已到账"
          ><template #extra
            ><el-button type="primary" @click="payDialog = false"
              >完成</el-button
            ></template
          ></el-result
        ><el-result
          v-else-if="['closed', 'failed'].includes(paymentStatus)"
          icon="warning"
          :title="paymentStatus === 'closed' ? '充值已关闭' : '支付未成功'"
          ><template #extra
            ><el-button @click="payDialog = false"
              >返回充值</el-button
            ></template
          ></el-result
        ><template v-else
          ><img
            v-if="payment?.invoke?.type === 'QR'"
            :src="payment.invoke.qrDataUrl"
            alt="微信充值付款二维码"
            width="240"
            height="240"
          />
          <p v-if="payment?.invoke?.type === 'QR'">请用微信扫码付款</p>
          <el-button
            v-if="payment?.invoke?.type === 'FORM'"
            type="primary"
            size="large"
            @click="invokeAlipay"
            >打开支付宝付款</el-button
          ><el-button
            v-else-if="!payment"
            type="primary"
            :loading="paying"
            @click="resume"
            >继续付款</el-button
          >
          <p
            v-else-if="!['QR', 'FORM'].includes(payment?.invoke?.type)"
            class="muted"
          >
            正在核对支付结果
          </p>
          <div class="payment-refresh">
            <el-button :icon="Refresh" :loading="pollBusy" @click="poll"
              >我已付款，查询到账</el-button
            >
          </div></template
        >
      </div>
      <div v-else-if="!pollError" class="empty" role="status">
        正在加载充值记录…
      </div></el-dialog
    >
  </section>
</template>
<style scoped>
.funds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.funds .panel {
  padding: 24px;
}
.funds .muted {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
}
.funds strong {
  display: block;
  font-size: 30px;
  margin: 16px 0;
}
.funds a,
.funds small {
  font-size: 13px;
}
.funds small {
  color: #637084;
}
.amount-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 18px 0;
}
.amount-options .el-button {
  margin: 0;
  min-width: 88px;
}
.channel-options {
  display: flex;
  flex-wrap: wrap;
}
.records-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.records-heading h2 {
  margin: 0;
}
.record-reason {
  font-size: 14px;
  color: #4c5a6e;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.payment {
  text-align: center;
}
.payment > strong {
  display: block;
  font-size: 32px;
  color: #bc2038;
}
.payment > p {
  font-size: 13px;
  margin: 16px 0;
}
.payment img {
  max-width: 100%;
  height: auto;
}
.payment-refresh {
  margin-top: 20px;
}
.inline-error {
  color: #af302c;
  line-height: 1.7;
  font-size: 14px;
}
@media (max-width: 650px) {
  .funds {
    gap: 12px;
  }
  .funds .panel {
    padding: 18px 16px;
  }
  .funds strong {
    font-size: 26px;
  }
  .record-card {
    padding: 16px;
  }
  .amount-options .el-button {
    flex: 1;
    min-width: 72px;
  }
}
</style>
