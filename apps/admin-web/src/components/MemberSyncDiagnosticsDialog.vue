<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { api, readableError, responseData } from "../api";
import { diagnosticSystem, diagnosticConnection, diagnosticRingSync, diagnosticUpload } from "../sync-diagnostic-display";
const props = defineProps<{ member: Record<string, any> | null }>();
const emit = defineEmits<{ close: [] }>();
const reports = ref<any[]>([]), loading = ref(false), error = ref("");
const collection = ref<{ connectionId: string; startedAt: string } | null>(null);
let generation = 0;
const labels: Record<string, string> = {
  connect: "连接", initialization: "首次初始化", capabilities: "功能读取", read: "读取记录", persist: "本机保存", upload: "上传记录", recover: "恢复同步",
  pending: "等待确认", ok: "已完成", partial: "部分完成", failed: "失败", blocked: "待处理", empty: "本次无记录",
  none: "—", unknown: "未分类异常", not_connected: "尚未连接", connection_lost: "连接中断", connect_failed: "连接失败", initialization_pending: "初始化待确认", decision_unknown: "首绑决定待确认", clear_requested: "清理已请求，未确认完成", clear_acknowledged: "已收到清理回执", capabilities_missing: "功能信息未齐", read_timeout: "读取超时", read_partial: "读取未完成", no_data: "本次未读到记录", save_failed: "本机保存失败", upload_failed: "上传失败", upload_rejected: "服务器拒收", unsupported_metric: "指标不在上传范围", record_conflict: "记录内容冲突", invalid_record: "记录校验失败", network_error: "网络异常", auth_expired: "登录失效", backend_unavailable: "诊断服务未就绪", busy: "正在执行其他操作", cancelled: "操作取消",
  ready: "已通过", decision_required: "等待首绑确认", reset_attempted: "指令已请求，结果待确认", history_clear_acknowledged: "已收到清理回执，待重新握手", native_pending: "设备准备待确认", unavailable: "状态读取失败",
  first_connection: "新账号首次连接", automatic: "历史自动上报", manual: "手动上报", recovery: "恢复后上报",
};
async function load() {
  const id = props.member?.id, request = ++generation;
  reports.value = []; collection.value = null; error.value = "";
  if (!id) { loading.value = false; return; }
  loading.value = true;
  try {
    const data = responseData<{ reports: any[]; collection?: { connectionId: string; startedAt: string } | null }>(await api.get(`/members/${encodeURIComponent(String(id))}/sync-diagnostics`));
    if (request === generation && props.member?.id === id) { reports.value = Array.isArray(data.reports) ? data.reports : []; collection.value = data.collection ?? null; }
  } catch (cause) { if (request === generation) error.value = readableError(cause); }
  finally { if (request === generation) loading.value = false; }
}
function close() { ++generation; reports.value = []; collection.value = null; loading.value = false; emit("close"); }
watch(() => props.member?.id, load, { immediate: true });
onBeforeUnmount(() => { ++generation; });
</script>

<template>
  <el-dialog :model-value="!!member" title="会员首次连接与同步情况" width="min(1000px, 95vw)" destroy-on-close @update:model-value="close">
    <p>会员 {{ member?.memberNo }} · {{ member?.nickname || '未填写昵称' }} <el-button :loading="loading" @click="load">刷新</el-button></p>
    <el-alert title="新版本仅采集新账号首次连接同步的一份摘要，后续连接不上报。保留旧版历史摘要，不包含健康数值或原始日志；暂无报告不代表没有故障。" type="info" :closable="false" />
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div v-loading="loading">
      <el-empty v-if="!loading && !error && !reports.length" :description="collection ? '首次连接摘要采集中或等待客户端补传，请稍后刷新。' : '暂无首次连接摘要。需使用支持自动采集的版本，已有绑定历史的账号不会补采。'" />
      <el-card v-for="entry in reports" :key="entry.report.reportId" style="margin-top:16px">
        <template #header>{{ new Date(entry.receivedAt).toLocaleString('zh-CN', { hour12: false }) }} · {{ labels[entry.report.mode] || '诊断' }}</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="手机系统">{{ diagnosticSystem(entry.report) }}</el-descriptions-item>
          <el-descriptions-item label="APP版本">{{ entry.report.appVersion }}（{{ entry.report.buildNumber }}）</el-descriptions-item>
          <el-descriptions-item label="戒指型号">{{ entry.report.model }} · 固件 {{ entry.report.firmware || '未提供' }}</el-descriptions-item>
          <el-descriptions-item label="连接结果">{{ diagnosticConnection(entry.report) }}</el-descriptions-item>
          <el-descriptions-item label="戒指同步">{{ diagnosticRingSync(entry.report) }}</el-descriptions-item>
          <el-descriptions-item label="云端上传">{{ diagnosticUpload(entry.report) }}</el-descriptions-item>
        </el-descriptions>
        <p v-if="collection">首次采集开始：{{ new Date(collection.startedAt).toLocaleString('zh-CN', { hour12: false }) }}</p>
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
