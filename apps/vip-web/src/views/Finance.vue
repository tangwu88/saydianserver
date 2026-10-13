<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { api, data, errorMessage, requestKey } from "../api";
import { date, ledgerTypes, money, statuses } from "../present";
const route = useRoute(),
  router = useRouter();
const depositMode = computed(() => route.path === "/deposit"),
  ledgerMode = computed(() => route.path === "/ledger");
const wallet = ref<any>(),
  ledger = ref<any[]>([]),
  recharges = ref<any[]>([]),
  page = ref(1),
  total = ref(0),
  account = ref(""),
  capabilities = ref<any[]>([]),
  busy = ref(false),
  paying = ref(false);
const form = reactive({ amount: 100, channel: "wechat_native" }),
  payment = ref<any>(),
  currentRecharge = ref<any>(),
  payDialog = ref(false);
let key = requestKey(),
  pendingInput: unknown = null,
  timer: ReturnType<typeof setInterval> | undefined,
  pollBusy = false,
  generation = 0;
const title = computed(() =>
  depositMode.value ? "保证金" : ledgerMode.value ? "资金流水" : "余额与充值",
);
function stopPolling() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
onBeforeUnmount(() => {
  generation++;
  stopPolling();
});
async function load() {
  const request = generation;
  busy.value = true;
  try {
    const funds = data(await api.get("/wallet"));
    if (request !== generation) return;
    wallet.value = funds;
    if (depositMode.value || ledgerMode.value) {
      const result = data(
        await api.get("/ledger", {
          params: {
            account: depositMode.value ? "DEPOSIT" : account.value,
            page: page.value,
          },
        }),
      );
      if (request === generation) {
        ledger.value = result.items;
        total.value = result.total;
      }
    } else {
      const [records, caps] = await Promise.all([
        api.get("/recharges", { params: { page: page.value } }),
        api.get("/payment-capabilities"),
      ]);
      if (request === generation) {
        recharges.value = data(records).items;
        total.value = data(records).total;
        capabilities.value = data(caps).items;
        const available = capabilities.value.find((item) => item.enabled);
        if (
          !capabilities.value.some(
            (item) => item.channel === form.channel && item.enabled,
          ) &&
          available
        )
          form.channel = available.channel;
      }
    }
  } catch (cause) {
    if (request === generation) ElMessage.error(errorMessage(cause));
  } finally {
    if (request === generation) busy.value = false;
  }
}
watch(
  () => route.path,
  async () => {
    generation++;
    stopPolling();
    payDialog.value = false;
    page.value = 1;
    pendingInput = null;
    key = requestKey();
    await load();
    if (route.params.id) await viewRecharge(String(route.params.id));
  },
  { immediate: true },
);
function channelLabel(channel: string) {
  return (
    (
      {
        wechat_native: "微信扫码支付",
        alipay_page: "支付宝网页支付",
        alipay_wap: "支付宝手机支付",
      } as Record<string, string>
    )[channel.toLowerCase()] || channel
  );
}
async function create() {
  if (paying.value) return;
  const amountCents = Math.round(Number(form.amount) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    ElMessage.warning("请输入有效充值金额");
    return;
  }
  paying.value = true;
  pendingInput ??= { amountCents, channel: form.channel, idempotencyKey: key };
  try {
    const recharge = data(await api.post("/recharges", pendingInput));
    currentRecharge.value = recharge;
    payment.value = recharge.payment;
    payDialog.value = true;
    pendingInput = null;
    key = requestKey();
    startPolling();
    await load();
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
    await load();
  } finally {
    paying.value = false;
  }
}
async function viewRecharge(id: string) {
  stopPolling();
  try {
    const recharge = data(await api.get(`/recharges/${id}`));
    currentRecharge.value = recharge;
    payment.value = recharge.payment;
    payDialog.value = true;
    if (
      payment.value &&
      !["succeeded", "closed", "failed"].includes(payment.value.status)
    )
      startPolling();
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
}
async function resume() {
  if (!currentRecharge.value || paying.value) return;
  paying.value = true;
  try {
    payment.value = data(
      await api.post(`/recharges/${currentRecharge.value.id}/payment`),
    );
    startPolling();
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  } finally {
    paying.value = false;
  }
}
function startPolling() {
  stopPolling();
  if (!currentRecharge.value || payment.value?.status === "succeeded") return;
  timer = setInterval(() => {
    void poll();
  }, 4000);
}
async function poll() {
  if (!currentRecharge.value || pollBusy) return;
  pollBusy = true;
  const id = currentRecharge.value.id,
    request = generation;
  try {
    const result = data(await api.get(`/recharges/${id}`));
    if (request !== generation || id !== currentRecharge.value?.id) return;
    currentRecharge.value = result;
    payment.value = result.payment;
    if (result.payment?.status === "succeeded") {
      stopPolling();
      ElMessage.success("充值已确认，余额已入账");
      await load();
    } else if (["closed", "failed"].includes(result.payment?.status))
      stopPolling();
  } catch {
    stopPolling();
  } finally {
    pollBusy = false;
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
      url.password
    )
      throw new Error();
    const formElement = document.createElement("form");
    formElement.method = "POST";
    formElement.action = url.toString();
    formElement.target = "_blank";
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
    ElMessage.error("支付页面暂不可用，请刷新充值状态");
  }
}
function closePayment() {
  stopPolling();
  if (route.params.id) void router.replace("/wallet");
}
</script>
<template>
  <section class="page" v-loading="busy">
    <div class="page-head">
      <div>
        <h1>{{ title }}</h1>
        <p>
          {{
            depositMode
              ? "查看独立保证金余额及总后台登记记录"
              : ledgerMode
                ? "查看充值、采购消费、退款及保证金明细"
                : "在线充值后，使用余额完成分销采购"
          }}
        </p>
      </div>
      <el-button @click="load">刷新</el-button>
    </div>
    <div class="funds">
      <article class="panel">
        <span class="muted">可消费余额</span
        ><strong>{{ money(wallet?.balanceCents) }}</strong>
      </article>
      <article class="panel">
        <span class="muted">保证金</span
        ><strong>{{ money(wallet?.depositCents) }}</strong
        ><small>独立记录，不用于采购付款</small>
      </article>
    </div>
    <div v-if="!depositMode && !ledgerMode" class="panel">
      <h2>在线充值</h2>
      <el-alert
        v-if="!capabilities.some((item) => item.enabled)"
        title="在线支付暂未配置，请联系赛电运营人员。"
        type="info"
        :closable="false"
        style="margin-bottom: 20px"
      /><el-form inline :disabled="paying || !!pendingInput"
        ><el-form-item label="充值金额（元）"
          ><el-input-number
            v-model="form.amount"
            :min="0.01"
            :max="21474836.47"
            :precision="2"
            :step="100" /></el-form-item
        ><el-form-item label="支付方式"
          ><el-select v-model="form.channel" style="width: 200px"
            ><el-option
              v-for="item in capabilities"
              :key="item.channel"
              :label="channelLabel(item.channel)"
              :value="item.channel"
              :disabled="!item.enabled" /></el-select></el-form-item></el-form
      ><el-button
        type="primary"
        :disabled="
          !capabilities.some(
            (item) => item.channel === form.channel && item.enabled,
          )
        "
        :loading="paying"
        @click="create"
        >{{ pendingInput ? "核对并继续原充值" : "创建充值" }}</el-button
      >
      <p class="muted hint">支付成功后，余额以平台确认的入账结果为准。</p>
    </div>
    <div class="panel">
      <h2>
        {{ depositMode ? "保证金记录" : ledgerMode ? "资金明细" : "充值记录" }}
      </h2>
      <div v-if="ledgerMode" class="toolbar">
        <el-select
          v-model="account"
          @change="
            page = 1;
            load();
          "
          style="width: 160px"
          ><el-option label="全部账户" value="" /><el-option
            label="消费余额"
            value="BALANCE" /><el-option label="保证金" value="DEPOSIT"
        /></el-select>
      </div>
      <el-table v-if="depositMode || ledgerMode" :data="ledger"
        ><el-table-column label="类型" min-width="130"
          ><template #default="scope">{{
            ledgerTypes[scope.row.type] || scope.row.type
          }}</template></el-table-column
        ><el-table-column label="账户" width="110"
          ><template #default="scope">{{
            scope.row.account === "BALANCE" ? "消费余额" : "保证金"
          }}</template></el-table-column
        ><el-table-column label="金额变动" min-width="130"
          ><template #default="scope"
            ><span :class="{ price: scope.row.deltaCents < 0 }"
              >{{ scope.row.deltaCents > 0 ? "+" : ""
              }}{{ money(scope.row.deltaCents) }}</span
            ></template
          ></el-table-column
        ><el-table-column label="账户余额" min-width="130"
          ><template #default="scope">{{
            money(scope.row.balanceAfterCents)
          }}</template></el-table-column
        ><el-table-column
          prop="reason"
          label="说明"
          min-width="230"
        /><el-table-column label="时间" min-width="180"
          ><template #default="scope">{{
            date(scope.row.createdAt)
          }}</template></el-table-column
        ></el-table
      ><el-table v-else :data="recharges"
        ><el-table-column
          prop="rechargeNo"
          label="充值编号"
          min-width="240"
        /><el-table-column label="金额" width="140"
          ><template #default="scope">{{
            money(scope.row.amountCents)
          }}</template></el-table-column
        ><el-table-column label="方式" min-width="160"
          ><template #default="scope">{{
            channelLabel(scope.row.channel)
          }}</template></el-table-column
        ><el-table-column label="状态" width="100"
          ><template #default="scope"
            ><el-tag
              :type="scope.row.status === 'SUCCEEDED' ? 'success' : 'info'"
              >{{ statuses[scope.row.status] || scope.row.status }}</el-tag
            ></template
          ></el-table-column
        ><el-table-column label="时间" min-width="180"
          ><template #default="scope">{{
            date(scope.row.createdAt)
          }}</template></el-table-column
        ><el-table-column label="操作" width="110"
          ><template #default="scope"
            ><el-button text type="primary" @click="viewRecharge(scope.row.id)"
              >查看</el-button
            ></template
          ></el-table-column
        ></el-table
      ><el-pagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
    <el-dialog
      v-model="payDialog"
      title="充值支付"
      width="520px"
      @closed="closePayment"
      ><div v-if="currentRecharge" class="payment">
        <strong>{{ money(currentRecharge.amountCents) }}</strong>
        <p class="muted">{{ currentRecharge.rechargeNo }}</p>
        <el-result
          v-if="payment?.status === 'succeeded'"
          icon="success"
          title="充值已入账"
        /><template v-else
          ><img
            v-if="payment?.invoke?.type === 'QR'"
            :src="payment.invoke.qrDataUrl"
            alt="微信充值支付二维码"
            width="260"
            height="260"
          />
          <p v-if="payment?.invoke?.type === 'QR'">请使用微信扫描二维码付款</p>
          <el-button
            v-if="payment?.invoke?.type === 'FORM'"
            type="primary"
            size="large"
            @click="invokeAlipay"
            >前往支付宝付款</el-button
          ><el-alert
            v-if="payment && !['QR', 'FORM'].includes(payment?.invoke?.type)"
            title="原支付结果待确认，请核对充值状态。"
            type="info"
            :closable="false"
          /><el-button
            v-if="!payment"
            type="primary"
            :loading="paying"
            @click="resume"
            >继续原充值</el-button
          ><el-button style="margin-top: 16px" @click="poll"
            >刷新充值状态</el-button
          ></template
        >
      </div></el-dialog
    >
  </section>
</template>
<style scoped>
.funds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.funds .panel {
  padding: 28px;
}
.funds strong {
  display: block;
  font-size: 32px;
  margin: 20px 0 10px;
}
.funds small {
  color: #99a2b2;
  font-size: 12px;
}
.hint {
  font-size: 12px;
  margin: 20px 0 0;
}
.payment {
  text-align: center;
}
.payment > strong {
  display: block;
  font-size: 32px;
  color: #c9223b;
}
.payment > p {
  font-size: 12px;
  margin: 15px 0 25px;
}
.payment img {
  max-width: 100%;
  height: auto;
}
@media (max-width: 760px) {
  .funds {
    gap: 12px;
  }
  .funds .panel {
    padding: 20px 16px;
  }
  .funds strong {
    font-size: 24px;
  }
}
</style>
