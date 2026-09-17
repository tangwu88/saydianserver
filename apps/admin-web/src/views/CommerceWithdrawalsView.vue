<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, readableError, responseData } from "../api";

type Withdrawal = { id: string; employeeId: string; employee: { name: string }; amountCents: number; status: string;
  executionOwner: string; sourceSystem: string; version: number; accountHint: string | null; providerTransferId: string | null;
  receiptReference: string | null; createdAt: string; reviewNote: string | null;
  payoutDetails: { payoutMethod: string; accountName: string; payoutAccount: string; bankName: string } };
const labels: Record<string, string> = { SUBMITTED: "待审核（佣金已冻结）", APPROVED: "历史已审核，待登记回执", PROCESSING: "供应商处理中",
  WAIT_USER_CONFIRM: "等待收款确认", SUCCEEDED: "已提现", FAILED: "已失败并释放冻结", REJECTED: "已拒绝并退回", CANCELLED: "已取消" };
const payoutLabels: Record<string, string> = { WECHAT: "微信", ALIPAY: "支付宝", BANK: "银行卡" };
const rows = ref<Withdrawal[]>([]), total = ref(0), page = ref(1), status = ref(""), loading = ref(false), busy = ref(false);
const active = ref<Withdrawal>(), action = ref<"APPROVE" | "REJECT" | "MANUAL" | "VERIFY">("APPROVE"), visible = ref(false);
const form = reactive({ note: "", providerTransferId: "", amountCents: 0, recipientOpenId: "", receiptReference: "", evidence: "", completedAt: "", result: "SUCCEEDED", confirmedExternalResult: false, idempotencyKey: "" });
const money = (value: number) => (value / 100).toFixed(2);
async function load() {
  loading.value = true;
  try { const data = responseData<{ items: Withdrawal[]; total: number }>(await api.get("/commerce/withdrawals", { params: { page: page.value, status: status.value, pageSize: 30 } })); rows.value = data.items; total.value = data.total; }
  catch (error) { ElMessage.error(readableError(error)); }
  finally { loading.value = false; }
}
function open(row: Withdrawal, mode: typeof action.value) {
  active.value = row; action.value = mode;
  Object.assign(form, { note: "", providerTransferId: mode === "VERIFY" ? row.providerTransferId || "" : "", amountCents: row.amountCents,
    recipientOpenId: "", receiptReference: "", evidence: "", completedAt: "", result: "SUCCEEDED", confirmedExternalResult: false, idempotencyKey: crypto.randomUUID() });
  visible.value = true;
}
async function save() {
  if (!active.value || busy.value) return;
  busy.value = true;
  try {
    const review = action.value === "APPROVE" || action.value === "REJECT";
    const endpoint = review ? "review" : action.value === "VERIFY" ? "verify-original-transfer" : "manual-receipt";
    await api.post(`/commerce/withdrawals/${active.value.id}/${endpoint}`, review
      ? { decision: action.value, note: form.note, version: active.value.version, idempotencyKey: form.idempotencyKey }
      : { ...form, version: active.value.version, completedAt: form.completedAt ? new Date(form.completedAt).toISOString() : "" });
    ElMessage.success(review ? (action.value === "APPROVE" ? "审核通过，已记为已提现" : "已拒绝并退回可用佣金") : "核验结果已入账；本系统未发起任何转账");
    visible.value = false; await load();
  } catch (error) { ElMessage.error(readableError(error)); }
  finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="page">
    <h1 class="page-title">用户提现</h1>
    <el-alert title="用户提交时已冻结对应佣金。审核通过前请核对收款信息并完成线下付款；通过后系统记为已提现并扣除冻结佣金。系统不会自动发起第三方转账。" type="warning" :closable="false" />
    <div class="toolbar">
      <el-select v-model="status" clearable placeholder="全部状态" style="width: 230px" @change="page = 1; load()"><el-option v-for="(label, key) in labels" :key="key" :value="key" :label="label" /></el-select>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" border empty-text="暂无提现记录">
      <el-table-column label="员工" min-width="120"><template #default="{ row }">{{ row.employee.name }}</template></el-table-column>
      <el-table-column prop="id" label="提现编号" min-width="180" show-overflow-tooltip />
      <el-table-column label="金额（元）" width="110"><template #default="{ row }">{{ money(row.amountCents) }}</template></el-table-column>
      <el-table-column label="收款信息" min-width="240"><template #default="{ row }">
        <div class="payout-detail"><b>{{ payoutLabels[row.payoutDetails?.payoutMethod] || row.payoutDetails?.payoutMethod || "历史账户" }}</b><span>{{ row.payoutDetails?.accountName || "未记录姓名" }} · {{ row.payoutDetails?.payoutAccount || row.accountHint || "未记录账号" }}</span><span v-if="row.payoutDetails?.bankName">{{ row.payoutDetails.bankName }}</span></div>
      </template></el-table-column>
      <el-table-column label="状态 / 所有权" min-width="190"><template #default="{ row }">{{ labels[row.status] || row.status }}<div class="muted">{{ row.executionOwner === 'NEW_SYSTEM' ? '新系统已接管' : '原系统锁定，待核验' }}</div></template></el-table-column>
      <el-table-column prop="providerTransferId" label="原转账单号" min-width="150" show-overflow-tooltip />
      <el-table-column label="操作" width="250"><template #default="{ row }">
        <template v-if="row.executionOwner === 'NEW_SYSTEM' && !row.providerTransferId">
          <el-button v-if="row.status === 'SUBMITTED'" size="small" type="primary" @click="open(row, 'APPROVE')">审核通过</el-button>
          <el-button v-if="['SUBMITTED', 'APPROVED'].includes(row.status)" size="small" type="danger" plain @click="open(row, 'REJECT')">拒绝</el-button>
          <el-button v-if="row.status === 'APPROVED'" size="small" type="primary" @click="open(row, 'MANUAL')">登记付款回执</el-button>
        </template>
        <el-button v-if="row.sourceSystem !== 'canonical' && ['PROCESSING', 'WAIT_USER_CONFIRM'].includes(row.status) && row.providerTransferId" size="small" @click="open(row, 'VERIFY')">核验原转账结果</el-button>
      </template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" :page-size="30" :total="total" layout="prev, pager, next, total" @current-change="load" />
    <el-dialog v-model="visible" :title="action === 'APPROVE' ? '审核通过并确认已提现' : action === 'REJECT' ? '拒绝并释放冻结' : action === 'VERIFY' ? '核验原供应商终态' : '登记已完成的人工付款'" width="min(720px, 94vw)" :close-on-click-modal="!busy" :show-close="!busy">
      <el-form label-width="125px" :disabled="busy">
        <el-form-item label="提现金额">¥ {{ money(active?.amountCents || 0) }}</el-form-item>
        <el-form-item v-if="active?.payoutDetails" label="收款信息">
          <div class="payout-detail"><b>{{ payoutLabels[active.payoutDetails.payoutMethod] || active.payoutDetails.payoutMethod }}</b><span>{{ active.payoutDetails.accountName }} · {{ active.payoutDetails.payoutAccount }}</span><span v-if="active.payoutDetails.bankName">{{ active.payoutDetails.bankName }}</span></div>
        </el-form-item>
        <template v-if="action === 'APPROVE' || action === 'REJECT'">
          <el-alert v-if="action === 'APPROVE'" title="确认前请先按上方收款信息完成线下付款。确认后前端会立即显示“已提现”，冻结佣金转入累计已付。" type="warning" :closable="false" />
          <el-form-item label="审核说明"><el-input v-model="form.note" type="textarea" :rows="3" maxlength="1000" placeholder="必填，例如：已核对收款信息并完成线下付款" /></el-form-item>
        </template>
        <template v-else>
          <el-alert title="必须先在原供应商/实际付款渠道核实结果，再登记。请勿为原在途提现重新付款；失败结果会释放冻结并优先抵还退款欠款。" :closable="false" type="warning" />
          <el-form-item label="原转账单号"><el-input v-model="form.providerTransferId" :disabled="action === 'VERIFY'" /></el-form-item>
          <el-form-item label="回执金额（分）"><el-input-number v-model="form.amountCents" :min="1" :precision="0" /></el-form-item>
          <el-form-item label="回执收款 openId"><el-input v-model="form.recipientOpenId" autocomplete="off" placeholder="从真实回执核对，必须与申请快照完全一致" /></el-form-item>
          <el-form-item label="回执凭证索引"><el-input v-model="form.receiptReference" placeholder="内网归档编号或凭证地址（不要填写密钥）" /></el-form-item>
          <el-form-item label="核验依据"><el-input v-model="form.evidence" type="textarea" :rows="3" placeholder="核验渠道、操作人和原始凭证依据" /></el-form-item>
          <el-form-item label="实际完成时间"><el-input v-model="form.completedAt" type="datetime-local" /></el-form-item>
          <el-form-item v-if="action === 'VERIFY'" label="供应商终态"><el-select v-model="form.result"><el-option value="SUCCEEDED" label="已确认成功" /><el-option value="FAILED" label="已确认失败（非超时或处理中）" /></el-select></el-form-item>
          <el-form-item><el-checkbox v-model="form.confirmedExternalResult">我已核验真实终态、金额与收款身份，理解不会发起转账</el-checkbox></el-form-item>
        </template>
      </el-form>
      <template #footer><el-button :disabled="busy" @click="visible = false">取消</el-button><el-button type="primary" :loading="busy" @click="save">确认登记</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>.toolbar { display: flex; gap: 12px; margin: 18px 0; }.el-pagination { margin-top: 18px; }.el-alert { margin-bottom: 16px; }.payout-detail{display:grid;gap:3px}.payout-detail span{color:#667085;font-size:12px;overflow-wrap:anywhere}</style>
