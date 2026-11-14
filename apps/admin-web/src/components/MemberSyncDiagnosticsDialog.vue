<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { api, readableError, responseData } from "../api";
const props = defineProps<{ member: Record<string, any> | null }>();
const emit = defineEmits<{ close: [] }>();
const reports = ref<any[]>([]), loading = ref(false), error = ref("");
let generation = 0;
const labels: Record<string, string> = {
  connect: "连接", initialization: "首次初始化", capabilities: "功能读取", read: "读取记录", persist: "本机保存", upload: "上传记录", recover: "恢复同步",
  pending: "等待确认", ok: "已完成", partial: "部分完成", failed: "失败", blocked: "待处理", empty: "本次无记录",
  none: "—", unknown: "未分类异常", not_connected: "尚未连接", connection_lost: "连接中断", connect_failed: "连接失败", initialization_pending: "初始化待确认", decision_unknown: "首绑决定待确认", clear_requested: "清理已请求，未确认完成", clear_acknowledged: "已收到清理回执", capabilities_missing: "功能信息未齐", read_timeout: "读取超时", read_partial: "读取未完成", no_data: "本次未读到记录", save_failed: "本机保存失败", upload_failed: "上传失败", upload_rejected: "服务器拒收", unsupported_metric: "指标不在上传范围", record_conflict: "记录内容冲突", invalid_record: "记录校验失败", network_error: "网络异常", auth_expired: "登录失效", backend_unavailable: "诊断服务未就绪", busy: "正在执行其他操作", cancelled: "操作取消",
  ready: "已通过", decision_required: "等待首绑确认", reset_attempted: "指令已请求，结果待确认", history_clear_acknowledged: "已收到清理回执，待重新握手", native_pending: "设备准备待确认", unavailable: "状态读取失败",
  automatic: "自动上报", manual: "手动上报", recovery: "恢复后上报",
};
async function load() {
  const id = props.member?.id, request = ++generation;
  reports.value = []; error.value = "";
  if (!id) { loading.value = false; return; }
  loading.value = true;
  try {
    const data = responseData<{ reports: any[] }>(await api.get(`/members/${encodeURIComponent(String(id))}/sync-diagnostics`));
    if (request === generation && props.member?.id === id) reports.value = Array.isArray(data.reports) ? data.reports : [];
  } catch (cause) { if (request === generation) error.value = readableError(cause); }
  finally { if (request === generation) loading.value = false; }
}
function close() { ++generation; reports.value = []; loading.value = false; emit("close"); }
watch(() => props.member?.id, load, { immediate: true });
onBeforeUnmount(() => { ++generation; });
</script>

<template>
  <el-dialog :model-value="!!member" title="会员同步诊断" width="min(1000px, 95vw)" destroy-on-close @update:model-value="close">
    <p>会员 {{ member?.memberNo }} · {{ member?.nickname || '未填写昵称' }} <el-button :loading="loading" @click="load">刷新</el-button></p>
    <el-alert title="显示客户端上报的最近5份摘要，不包含健康数值或原始日志。旧版本没有诊断上报；没有报告不代表没有故障。" type="info" :closable="false" />
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div v-loading="loading">
      <el-empty v-if="!loading && !error && !reports.length" description="暂无同步诊断，请客户升级支持诊断的版本后重试，或在设备页上传诊断。" />
      <el-card v-for="entry in reports" :key="entry.report.reportId" style="margin-top:16px">
        <template #header>{{ new Date(entry.receivedAt).toLocaleString('zh-CN', { hour12: false }) }} · {{ labels[entry.report.mode] || '诊断' }}</template>
        <p>{{ entry.report.platform }} {{ entry.report.appVersion }}（{{ entry.report.buildNumber }}） · {{ entry.report.model }} · {{ entry.report.sdk }} · 固件 {{ entry.report.firmware || '未提供' }}</p>
        <p v-if="entry.report.phone" style="overflow-wrap:anywhere">
          手机：{{ [entry.report.phone.brand,entry.report.phone.modelName,entry.report.phone.modelId].filter(Boolean).join(' · ') || '未提供' }}　
          系统：{{ entry.report.phone.osVersion || '未提供' }} {{ entry.report.phone.osBuild || '' }}
          <span v-if="entry.report.phone.apiLevel !== undefined"> · API {{ entry.report.phone.apiLevel }}</span>
          <span v-if="entry.report.phone.locale"> · {{ entry.report.phone.locale }}</span>
        </p>
        <p v-if="entry.report.connectionKind">连接方式：{{ ({first:'首次连接',explicit:'主动连接',automatic_recovery:'自动恢复'} as Record<string,string>)[entry.report.connectionKind] || '其他' }}</p>
        <p>初始化：{{ labels[entry.report.initializationState] || '待确认' }}　报告编号：{{ entry.report.reportId }}</p>
        <el-table :data="entry.report.stages" border>
          <el-table-column label="阶段" width="115"><template #default="scope">{{ labels[scope.row.stage] || '其他' }}</template></el-table-column>
          <el-table-column label="结果" width="110"><template #default="scope">{{ labels[scope.row.state] || '待确认' }}</template></el-table-column>
          <el-table-column label="原因" min-width="170"><template #default="scope">{{ labels[scope.row.code] || '未分类异常' }}</template></el-table-column>
          <el-table-column label="累计耗时" width="110"><template #default="scope">{{ (scope.row.elapsedMs / 1000).toFixed(1) }} 秒</template></el-table-column>
          <el-table-column label="记录数量" min-width="220"><template #default="scope"><span v-if="scope.row.received !== undefined">读取 {{ scope.row.received }}　</span><span v-if="scope.row.saved !== undefined">保存 {{ scope.row.saved }}　</span><span v-if="scope.row.uploaded !== undefined">上传 {{ scope.row.uploaded }}　</span><span v-if="scope.row.rejected !== undefined">拒收 {{ scope.row.rejected }}</span></template></el-table-column>
        </el-table>
      </el-card>
    </div>
  </el-dialog>
</template>
