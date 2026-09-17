<script setup lang="ts">
import { mallStorage } from "../realm";
import { onMounted, ref } from "vue";
import { api, money, toast, API_BASE } from "../api";

const data = ref<any>(), amount = ref(""), busy = ref(false), loading = ref(false), requestKey = ref("");
const payoutOptions = [
  { label: "微信", value: "WECHAT" },
  { label: "支付宝", value: "ALIPAY" },
  { label: "银行卡", value: "BANK" },
];
const payoutMethod = ref("WECHAT"), accountName = ref(""), payoutAccount = ref(""), bankName = ref("");
const props=withDefaults(defineProps<{employeeId:string;memberMode?:boolean}>(),{memberMode:false});
const uncertain=ref(false);
const labels: Record<string, string> = { SUBMITTED: "待审核（佣金已冻结）", APPROVED: "历史审核记录待确认", PROCESSING: "付款处理中", WAIT_USER_CONFIRM: "等待确认收款", SUCCEEDED: "已提现", FAILED: "已失败并退回", REJECTED: "已拒绝并退回", CANCELLED: "已取消" };
function request(method = "GET", body?: unknown) {
  if (props.memberMode) {
    return api("/storefront/promoter/withdrawals", {
      method: method as any,
      data: body,
      auth: true,
    });
  }
  const token=String(mallStorage.get('employee-token')||'');
  return new Promise<any>((resolve, reject) => uni.request({
    url: `${API_BASE}/wecom/me/withdrawals`, method: method as "GET" | "POST", data: body as any,
    header: { authorization: `Bearer ${token}` },timeout:15000,
    success: (response) => { if(token!==String(mallStorage.get('employee-token')||''))return reject(new Error('员工账号已切换'));
      response.statusCode < 300 ? resolve(response.data) : reject(Object.assign(new Error((response.data as any)?.message || '提现请求失败'),{status:response.statusCode})); }, fail: reject,
  }));
}
function draftOwner(){return `${props.memberMode?'member':'employee'}:${props.employeeId}`;}
async function load() { loading.value = true; data.value=undefined;try { data.value = await request(); } catch (error) { toast(error); } finally { loading.value = false; } }
async function apply() {
  if (busy.value) return;
  if (!/^\d+(\.\d{1,2})?$/.test(amount.value)) { toast(new Error("请输入最多两位小数的提现金额")); return; }
  const [yuan, fraction = ""] = amount.value.split(".");
  const amountCents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) { toast(new Error("提现金额必须大于零")); return; }
  if (!accountName.value.trim()) { toast(new Error("请输入收款人姓名")); return; }
  if (!payoutAccount.value.trim()) { toast(new Error("请输入收款账号")); return; }
  if (payoutMethod.value === "BANK" && !bankName.value.trim()) { toast(new Error("请输入开户银行")); return; }
  // Retain the key through uncertain retries; input changes clear it. This key is not an auth credential.
  if (!requestKey.value) requestKey.value = `employee_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  busy.value = true;
  try {const saved=mallStorage.get('employee-withdrawal-draft');const payload=saved?.owner===draftOwner()&&saved.uncertain?saved.payload:{amountCents,idempotencyKey:requestKey.value,payoutMethod:payoutMethod.value,accountName:accountName.value.trim(),payoutAccount:payoutAccount.value.trim(),bankName:bankName.value.trim()};mallStorage.set('employee-withdrawal-draft',{owner:draftOwner(),payload,uncertain:true});uncertain.value=true;
    await request('POST',payload);mallStorage.remove('employee-withdrawal-draft');uncertain.value=false;amount.value = ''; accountName.value='';payoutAccount.value='';bankName.value='';requestKey.value = ''; uni.showToast({ title: '已提交，佣金已冻结', icon: 'none' }); await load(); }
  catch (error) { if([400,403,409,422].includes((error as any)?.status)){uncertain.value=false;mallStorage.remove('employee-withdrawal-draft');}toast(error); }
  finally { busy.value = false; }
}
function choosePayout(event:any){const option=payoutOptions[Number(event?.detail?.value)];if(option){payoutMethod.value=option.value;requestKey.value='';}}
onMounted(()=>{const saved=mallStorage.get('employee-withdrawal-draft');if(saved?.owner===draftOwner()&&saved.uncertain){uncertain.value=true;requestKey.value=saved.payload.idempotencyKey;amount.value=(saved.payload.amountCents/100).toFixed(2);payoutMethod.value=saved.payload.payoutMethod||'WECHAT';accountName.value=saved.payload.accountName||'';payoutAccount.value=saved.payload.payoutAccount||'';bankName.value=saved.payload.bankName||'';}else mallStorage.remove('employee-withdrawal-draft');void load();});
</script>

<template>
  <view class="withdrawal-panel card">
    <view class="heading"><text>{{ props.memberMode ? '提现' : '员工提现' }}</text><button class="text-button" size="mini" :disabled="loading || busy" @click="load">刷新</button></view>
    <template v-if="data">
      <view v-if="data.wallet" class="balance-summary"><view><text>可提现</text><b>{{ money(data.wallet.availableCents) }}</b></view><view v-if="data.wallet.withdrawingCents"><text>处理中</text><b>{{ money(data.wallet.withdrawingCents) }}</b></view></view>
      <view v-else class="notice">账户数据暂未获取。</view>
      <text class="rules">有可用佣金即可申请。提交后对应金额会冻结，后台审核通过后显示为已提现；拒绝后退回可用佣金。</text>
      <view v-if="data.pendingCount" class="notice">已有申请处理中，请勿重复提交。</view>
      <view v-if="data.wallet?.debtCents > 0" class="notice">退款抵扣 {{ money(data.wallet.debtCents) }}，暂不可申请。</view>
      <view v-if="uncertain" class="notice">上次结果待确认，将继续原申请。</view>
      <view class="payout-form">
        <picker :range="payoutOptions" range-key="label" :disabled="busy || uncertain" @change="choosePayout"><view class="input picker-value">收款方式：{{ payoutOptions.find(item => item.value === payoutMethod)?.label }}</view></picker>
        <input v-model="accountName" class="input" placeholder="收款人姓名" :disabled="busy || uncertain" @input="requestKey = ''" />
        <input v-model="payoutAccount" class="input" :placeholder="payoutMethod === 'BANK' ? '银行卡号' : payoutMethod === 'ALIPAY' ? '支付宝账号' : '微信号或绑定手机号'" :disabled="busy || uncertain" @input="requestKey = ''" />
        <input v-if="payoutMethod === 'BANK'" v-model="bankName" class="input" placeholder="开户银行" :disabled="busy || uncertain" @input="requestKey = ''" />
      </view>
      <view class="apply"><input v-model="amount" class="input" type="digit" placeholder="输入提现金额" :disabled="busy || uncertain || !data.canApply" @input="requestKey = ''" /><button class="primary-btn" size="mini" :loading="busy" :disabled="busy || (!uncertain && !data.canApply)" @click="apply">{{ uncertain ? '继续申请' : '申请提现' }}</button></view>
      <view v-if="data.withdrawals.length" class="withdrawal-history"><h3>提现记录</h3><view v-for="row in data.withdrawals" :key="row.id" class="withdrawal-row"><view><b>{{ money(row.amountCents) }}</b><text>{{ labels[row.status] || row.status }}</text></view><text class="tip">{{ new Date(row.createdAt).toLocaleString() }}{{ row.executionOwner !== 'NEW_SYSTEM' && row.pending ? ' · 原系统待核验' : '' }}</text></view></view>
      <view v-else class="tip">暂无提现记录</view>
    </template>
    <view v-else class="tip">{{ loading ? '加载中…' : '未获取提现数据，请重试' }}</view>
  </view>
</template>
<style scoped>.withdrawal-panel{padding:24rpx;margin:24rpx 0}.heading,.apply{display:flex;align-items:center;justify-content:space-between;gap:16rpx}.heading{font-size:19px;font-weight:800}.heading .text-button{width:auto;margin:0;padding:6px 0}.balance-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}.balance-summary>view{min-width:0;padding:14px;border-radius:12px;background:#fff7f8}.balance-summary text,.balance-summary b{display:block}.balance-summary text{color:#667085;font-size:13px}.balance-summary b{margin-top:5px;color:#d20b27;font-size:20px;overflow-wrap:anywhere}.rules{display:block;margin:10px 0;color:#667085;font-size:13px;line-height:1.6}.notice{margin:10px 0;padding:10px 12px;border-radius:10px;background:#fff6de;color:#79500b;font-size:13px;line-height:1.6}.tip{display:block;margin:12px 0;color:#667085;font-size:12px;line-height:1.6}.payout-form{display:grid;gap:10px;margin-top:14px}.input{box-sizing:border-box;width:100%;height:48px;padding:0 14px;border:1px solid #d0d5dd;border-radius:12px;background:#fff}.picker-value{display:flex;align-items:center;color:#344054}.apply{margin-top:12px}.apply .input{flex:1;min-width:0}.apply .primary-btn{width:auto;min-width:112px;min-height:48px;margin:0;padding:10px 14px}.withdrawal-history{margin-top:20px}.withdrawal-history h3{margin:0 0 8px;font-size:16px}.withdrawal-row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #e4e7ec}.withdrawal-row>view{display:grid;gap:4px}.withdrawal-row>view text{color:#667085;font-size:12px}.withdrawal-row>.tip{text-align:right;margin:0}@media(max-width:360px){.apply{align-items:stretch;flex-direction:column}.apply .primary-btn{width:100%}}</style>
