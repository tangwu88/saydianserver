<script setup lang="ts">
import { mallStorage, isGlobalMall, globalCommerceNotice } from "../realm";
import { onMounted, ref } from "vue";
import { money, toast, API_BASE } from "../api";

const data = ref<any>(), amount = ref(""), busy = ref(false), loading = ref(false), requestKey = ref("");
const props=defineProps<{employeeId:string}>();
const uncertain=ref(false);
const labels: Record<string, string> = { SUBMITTED: "待审核", APPROVED: "已审核", PROCESSING: "付款处理中", WAIT_USER_CONFIRM: "等待确认收款", SUCCEEDED: "已付款", FAILED: "已失败并退回", REJECTED: "已拒绝", CANCELLED: "已取消" };
function request(method = "GET", body?: unknown) {
  if (isGlobalMall) return Promise.reject(new Error(globalCommerceNotice));
  const token=String(mallStorage.get('employee-token')||'');
  return new Promise<any>((resolve, reject) => uni.request({
    url: `${API_BASE}/wecom/me/withdrawals`, method: method as "GET" | "POST", data: body as any,
    header: { authorization: `Bearer ${token}` },timeout:15000,
    success: (response) => { if(token!==String(mallStorage.get('employee-token')||''))return reject(new Error('员工账号已切换'));
      response.statusCode < 300 ? resolve(response.data) : reject(Object.assign(new Error((response.data as any)?.message || '提现请求失败'),{status:response.statusCode})); }, fail: reject,
  }));
}
async function load() { loading.value = true; data.value=undefined;try { data.value = await request(); } catch (error) { toast(error); } finally { loading.value = false; } }
async function apply() {
  if (busy.value) return;
  if (!/^\d+(\.\d{1,2})?$/.test(amount.value)) { toast(new Error("请输入最多两位小数的提现金额")); return; }
  const [yuan, fraction = ""] = amount.value.split(".");
  const amountCents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) { toast(new Error("提现金额必须大于零")); return; }
  // Retain the key through uncertain retries; input changes clear it. This key is not an auth credential.
  if (!requestKey.value) requestKey.value = `employee_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  busy.value = true;
  try {const saved=mallStorage.get('employee-withdrawal-draft');const payload=saved?.employeeId===props.employeeId&&saved.uncertain?saved.payload:{amountCents,idempotencyKey:requestKey.value};mallStorage.set('employee-withdrawal-draft',{employeeId:props.employeeId,payload,uncertain:true});uncertain.value=true;
    await request('POST',payload);mallStorage.remove('employee-withdrawal-draft');uncertain.value=false;amount.value = ''; requestKey.value = ''; uni.showToast({ title: '已申请，等待审核', icon: 'none' }); await load(); }
  catch (error) { if([400,403,409,422].includes((error as any)?.status)){uncertain.value=false;mallStorage.remove('employee-withdrawal-draft');}toast(error); }
  finally { busy.value = false; }
}
onMounted(()=>{const saved=mallStorage.get('employee-withdrawal-draft');if(saved?.employeeId===props.employeeId&&saved.uncertain){uncertain.value=true;requestKey.value=saved.payload.idempotencyKey;amount.value=(saved.payload.amountCents/100).toFixed(2);}else mallStorage.remove('employee-withdrawal-draft');void load();});
</script>

<template>
  <view class="withdrawal-panel card">
    <view class="heading"><text>员工提现</text><button size="mini" :disabled="loading || busy" @click="load">刷新</button></view>
    <template v-if="data">
      <view v-if="data.wallet" class="balances">可提现 {{ money(data.wallet.availableCents) }} · 提现中 {{ money(data.wallet.withdrawingCents) }} · 已支付 {{ money(data.wallet.totalPaidCents) }}</view>
      <view v-else class="tip">佣金钱包未获取或未完成迁移核验。</view>
      <view v-if="!data.plan.enabled" class="tip">员工提现尚未启用。</view>
      <view class="tip">最低提现：{{ data.plan.minimumWithdrawCents === null ? '未配置' : money(data.plan.minimumWithdrawCents) }}；每日限额：{{ data.plan.dailyWithdrawLimitCents === null ? '未设额外限额' : money(data.plan.dailyWithdrawLimitCents) }}（北京时间）</view>
      <view v-if="data.pendingCount" class="tip">已有提现处理中，请等待原提现完成，勿重复申请。</view>
      <view v-if="!data.identity.verified" class="tip">收款身份未核验，请联系管理员。系统不会使用未核验身份或自动转账。</view>
      <view v-else class="tip">收款身份：{{ data.identity.accountHint }}；审核通过后由管理员核验真实付款回执。</view>
      <view v-if="data.wallet?.debtCents > 0" class="tip">存在退款欠款 {{ money(data.wallet.debtCents) }}，暂不可申请。</view>
      <view v-if="uncertain" class="tip">上次提现结果待确认，将复用原申请编号恢复，不能再次申请另一笔。</view><view class="apply"><input v-model="amount" type="digit" placeholder="提现金额（元）" :disabled="busy || uncertain || !data.canApply" @input="requestKey = ''" /><button size="mini" :loading="busy" :disabled="busy || (!uncertain && !data.canApply)" @click="apply">{{ uncertain ? '恢复上次申请' : '申请提现' }}</button></view>
      <view v-for="row in data.withdrawals" :key="row.id" class="withdrawal-row"><view>{{ money(row.amountCents) }} · {{ labels[row.status] || row.status }}</view><view class="tip">{{ new Date(row.createdAt).toLocaleString() }}{{ row.executionOwner !== 'NEW_SYSTEM' && row.pending ? ' · 原系统锁定待核验' : '' }}</view></view>
      <view v-if="!data.withdrawals.length" class="tip">暂无提现记录</view>
    </template>
    <view v-else class="tip">{{ loading ? '加载中…' : '未获取提现数据，请重试' }}</view>
  </view>
</template>
<style scoped>.withdrawal-panel { padding: 24rpx; margin: 24rpx 0; }.heading,.apply { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }.heading { font-weight: 700; }.balances,.tip { margin: 16rpx 0; }.tip { color: #667085; font-size: 24rpx; }.apply input { flex: 1; border: 1px solid #d0d5dd; padding: 14rpx; border-radius: 10rpx; }.withdrawal-row { border-top: 1px solid #e4e7ec; padding-top: 12rpx; }</style>
