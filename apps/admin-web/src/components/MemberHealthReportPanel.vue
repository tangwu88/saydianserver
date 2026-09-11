<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { api, readableError, responseData } from "../api";
import { healthMetricLabel, healthTime } from "../health-display";

type Report = { id: string; status: string; memberId?: string; failureReason?: string | null; generatedAt?: string | null; period?: { from: string; to: string }; content?: { overview?: string; trends?: { metric: string; text: string }[]; suggestions?: string[]; limitations?: string[] }; limitations?: string[] };
type Availability = { canGenerate: boolean; reasons: { code: string; message: string }[]; period: { from: string; to: string }; validRecordCount: number; distinctDays: number; minimumDistinctDays: number; availableCredits: number; memberConsentBypass?: boolean; reportCreditBypass?: boolean; latestReport?: Report | null };
const props = defineProps<{ memberId: string }>();
const availability = ref<Availability | null>(null);
const report = ref<Report | null>(null);
const checking = ref(false);
const generating = ref(false);
const reading = ref(false);
const previewing = ref(false);
const previewVisible = ref(false);
const previewReport = ref<Report | null>(null);
const errorMessage = ref("");
const pausedPolling = ref(false);
const inProgress = computed(() => ["queued", "generating"].includes(report.value?.status ?? ""));
const statusLabels: Record<string, string> = { awaiting_payment: "待获取报告次数", queued: "已排队", generating: "AI 分析中", ready: "已生成", failed: "生成失败", revoked: "已撤销" };
const reportStatus = computed(() => statusLabels[report.value?.status ?? ""] ?? "状态待确认");
const previewLimitations = computed(() => Array.from(new Set([
  ...(previewReport.value?.content?.limitations ?? []),
  ...(previewReport.value?.limitations ?? []),
].map(item => String(item).trim()).filter(Boolean))));
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let polls = 0;
let idempotencyKey = "";

function clearPolling(): void { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
function current(id: number, memberId: string): boolean { return id === generation && memberId === props.memberId; }
function schedulePoll(): void {
  clearPolling();
  if (!inProgress.value) return;
  if (polls >= 60) { pausedPolling.value = true; return; }
  timer = setTimeout(() => { polls++; void readReport(); }, 5_000);
}
async function fetchReportDetail(reportId: string, memberId: string): Promise<Report> {
  const result = responseData<Report>(await api.get(`/health-reports/${encodeURIComponent(reportId)}`));
  if (!result || result.id !== reportId || result.memberId !== memberId) throw new Error("报告归属不匹配，请刷新后重试");
  return result;
}
async function readReport(): Promise<void> {
  if (!report.value?.id || reading.value) return;
  const version = generation; const memberId = props.memberId; const reportId = report.value.id;
  reading.value = true;
  try {
    const result = await fetchReportDetail(reportId, memberId);
    if (!current(version, memberId) || report.value?.id !== reportId) return;
    report.value = result; errorMessage.value = "";
    schedulePoll();
  } catch (error) {
    if (current(version, memberId)) { errorMessage.value = readableError(error); clearPolling(); }
  } finally { if (current(version, memberId)) reading.value = false; }
}
async function openPreview(): Promise<void> {
  if (!report.value?.id || report.value.status !== "ready" || previewing.value) return;
  const version = generation; const memberId = props.memberId; const reportId = report.value.id;
  previewing.value = true; errorMessage.value = "";
  try {
    // Opening a sensitive report is a distinct audited read. Do not reuse a
    // previously polled response as proof that the current admin viewed it.
    const result = await fetchReportDetail(reportId, memberId);
    if (!current(version, memberId) || report.value?.id !== reportId) return;
    if (result.status !== "ready" || !result.content) throw new Error("报告正文尚未就绪，请刷新报告状态后重试");
    report.value = result;
    previewReport.value = result;
    previewVisible.value = true;
  } catch (error) {
    if (current(version, memberId)) errorMessage.value = readableError(error);
  } finally { if (current(version, memberId)) previewing.value = false; }
}
async function checkAvailability(): Promise<void> {
  if (checking.value || generating.value) return;
  const version = generation; const memberId = props.memberId;
  checking.value = true; errorMessage.value = "";
  try {
    const result = responseData<Availability>(await api.get("/health-reports/availability", { params: { memberId } }));
    if (!current(version, memberId)) return;
    if (!result || typeof result.canGenerate !== "boolean" || !Array.isArray(result.reasons)) throw new Error("报告条件返回不完整");
    availability.value = result;
    if (result.latestReport?.id && result.latestReport.id !== report.value?.id) {
      clearPolling(); report.value = result.latestReport; polls = 0; pausedPolling.value = false; await readReport();
    }
  } catch (error) {
    if (current(version, memberId)) { availability.value = null; errorMessage.value = readableError(error); }
  } finally { if (current(version, memberId)) checking.value = false; }
}
async function generateReport(): Promise<void> {
  if (generating.value || checking.value || reading.value || !availability.value?.canGenerate || inProgress.value) return;
  const version = generation; const memberId = props.memberId;
  generating.value = true; errorMessage.value = "";
  try {
    const authority = availability.value.memberConsentBypass
      ? "本次由超级管理员从总后台发起，无需会员在 App 端另行同意；操作将写入审计。"
      : "本次按当前管理员权限及会员授权状态执行。";
    const entitlement = availability.value.reportCreditBypass
      ? "本次由超级管理员生成，不占用会员的报告次数。"
      : "本次将使用该会员 1 次可用报告次数。";
    await ElMessageBox.confirm(`${entitlement}已配置的 AI 服务将分析近 30 天去标识化的基础资料、设备及健康趋势。${authority}相同数据已有报告时直接复用。结果仅供健康管理参考。`, "生成 AI 健康报告", { confirmButtonText: "确认生成", cancelButtonText: "取消", type: "warning" });
    if (!current(version, memberId)) return;
    idempotencyKey ||= crypto.randomUUID();
    const result = responseData<{ report: Report; reused: boolean }>(await api.post("/health-reports", { memberId, idempotencyKey }));
    if (!current(version, memberId)) return;
    if (!result?.report?.id) throw new Error("未取得报告编号，请重试查询");
    report.value = result.report; idempotencyKey = ""; polls = 0; pausedPolling.value = false;
    await readReport();
  } catch (error) {
    if (current(version, memberId) && error !== "cancel" && error !== "close") errorMessage.value = readableError(error);
  } finally {
    if (current(version, memberId)) {
      generating.value = false;
      // Credits can change while generating/reusing; always reload the actual
      // server balance, including after a lost POST response.
      if (report.value) void checkAvailability();
    }
  }
}
function reset(): void {
  generation++; clearPolling(); polls = 0; idempotencyKey = "";
  availability.value = null; report.value = null; previewReport.value = null; previewVisible.value = false;
  checking.value = false; generating.value = false; reading.value = false; previewing.value = false; errorMessage.value = ""; pausedPolling.value = false;
}
watch(() => props.memberId, () => { reset(); void checkAvailability(); }, { immediate: true });
onBeforeUnmount(() => { generation++; clearPolling(); });
</script>

<template>
  <section class="report-panel" aria-label="AI 健康报告">
    <header><div><h3>AI 健康报告</h3><p>仅分析近 30 天有效数据；每次生成和查看都会写入审计记录。</p></div>
      <el-button type="primary" :loading="generating" :disabled="checking || reading || !availability?.canGenerate || inProgress" @click="generateReport">AI 分析并生成健康报告</el-button>
    </header>
    <p v-if="checking" role="status">正在检查生成条件…</p>
    <p v-if="errorMessage" class="report-error" role="alert">{{ errorMessage }}</p>
    <template v-if="availability">
      <p class="coverage">有效记录 {{ availability.validRecordCount }} 条 · 覆盖 {{ availability.distinctDays }} 天（至少 {{ availability.minimumDistinctDays }} 天）<template v-if="availability.reportCreditBypass"> · 管理员生成不占用会员次数</template><template v-else> · 可用报告次数 {{ availability.availableCredits }} 次</template></p>
      <ul v-if="availability.reasons.length" class="blocked-reasons" aria-label="暂不能生成的原因"><li v-for="reason in availability.reasons" :key="reason.code">{{ reason.message }}</li></ul>
      <p v-else class="ready-hint">已满足生成条件，点击后仍由服务端复核。</p>
    </template>
    <el-button link type="primary" :loading="checking" :disabled="generating || reading" @click="checkAvailability">重新检查生成条件</el-button>
    <article v-if="report" class="report-result">
      <h4>最近报告 · {{ reportStatus }}</h4>
      <p v-if="report.period">统计期间：{{ healthTime(report.period.from, 0) }} 至 {{ healthTime(report.period.to, 0) }}</p>
      <p v-if="inProgress" role="status">报告已保存，可关闭窗口后重新查看；不会因刷新重复创建。</p>
      <p v-if="pausedPolling">已暂停自动刷新，可点击下方按钮查询最新结果。</p>
      <p v-if="report.status === 'failed'" class="report-error">{{ report.failureReason || '生成未完成，请核对服务配置及失败记录。' }}</p>
      <p v-if="report.status === 'revoked'">报告已撤销，不再展示分析内容。</p>
      <template v-if="report.status === 'ready' && report.content">
        <p class="ai-label">AI 生成 · 请结合实际情况核对，不作为诊断或治疗依据</p>
        <div class="report-summary">
          <div><h4>健康概览</h4><p>{{ report.content.overview || '报告已生成，可打开完整报告查看分析内容。' }}</p></div>
          <el-button type="primary" plain :loading="previewing" @click="openPreview">预览完整报告</el-button>
        </div>
      </template>
      <el-button link type="primary" :loading="reading" @click="readReport">刷新报告状态</el-button>
    </article>
    <p class="disclaimer">健康记录可能存在设备误差或数据缺失。AI 分析仅供日常健康管理参考；如有不适，请及时就医。</p>

    <el-dialog v-model="previewVisible" title="AI 健康报告预览" width="min(880px, 94vw)" top="4vh" append-to-body destroy-on-close :close-on-click-modal="false" @closed="previewReport = null">
      <article v-if="previewReport?.content" class="preview-document" aria-label="完整 AI 健康报告">
        <el-alert title="本报告由 AI 根据可用健康数据生成，仅供日常健康管理参考，不作为诊断或治疗依据。" type="warning" show-icon :closable="false" />
        <div class="preview-meta">
          <div><span>报告状态</span><strong>已生成</strong></div>
          <div v-if="previewReport.generatedAt"><span>生成时间</span><strong>{{ healthTime(previewReport.generatedAt, 0) }}</strong></div>
          <div v-if="previewReport.period" class="wide"><span>统计期间</span><strong>{{ healthTime(previewReport.period.from, 0) }} 至 {{ healthTime(previewReport.period.to, 0) }}</strong></div>
        </div>
        <section class="preview-section overview-section"><h3>健康概览</h3><p>{{ previewReport.content.overview || '本次报告暂无概览内容。' }}</p></section>
        <section v-if="previewReport.content.trends?.length" class="preview-section"><h3>健康趋势</h3>
          <div class="trend-grid"><article v-for="(trend, index) in previewReport.content.trends" :key="index" class="trend-card"><h4>{{ healthMetricLabel(trend.metric) }}</h4><p>{{ trend.text }}</p></article></div>
        </section>
        <section v-if="previewReport.content.suggestions?.length" class="preview-section"><h3>日常健康建议</h3><ol><li v-for="(suggestion, index) in previewReport.content.suggestions" :key="index">{{ suggestion }}</li></ol></section>
        <section v-if="previewLimitations.length" class="preview-section limitation-section"><h3>数据与分析局限</h3><ul><li v-for="(limitation, index) in previewLimitations" :key="index">{{ limitation }}</li></ul></section>
      </article>
      <template #footer><el-button @click="previewVisible = false">关闭</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.report-panel { border: 1px solid #dbe7f4; border-radius: 8px; padding: 18px; margin-top: 20px; background: #f8fbff; color: #263446; font-size: 13px; line-height: 1.65; }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
h3 { margin: 0; font-size: 17px; } h4 { margin: 12px 0 6px; font-size: 14px; } p { margin: 7px 0; overflow-wrap: anywhere; }
header p, .coverage, .disclaimer { color: #657387; } .report-error { color: #b33838; }
.blocked-reasons { background: #fff7e9; color: #855c16; padding: 10px 14px 10px 30px; border-radius: 6px; }
.ready-hint { color: #25704d; } .report-result { border-top: 1px solid #dbe7f4; margin-top: 12px; padding-top: 5px; } .ai-label { font-weight: 600; color: #346aa5; }
.report-summary { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding: 12px 14px; border: 1px solid #dbe7f4; border-radius: 8px; background: #fff; }
.report-summary h4 { margin-top: 0; } .report-summary p { max-width: 620px; margin-bottom: 0; }
.preview-document { max-height: 72vh; overflow: auto; padding: 0 4px 8px; color: #263446; line-height: 1.75; }
.preview-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
.preview-meta > div { display: flex; flex-direction: column; gap: 3px; padding: 11px 14px; border-radius: 8px; background: #f5f8fc; }
.preview-meta .wide { grid-column: 1 / -1; } .preview-meta span { color: #657387; font-size: 12px; } .preview-meta strong { font-size: 13px; overflow-wrap: anywhere; }
.preview-section { padding: 17px 0; border-top: 1px solid #e4eaf2; } .preview-section h3 { margin: 0 0 10px; font-size: 17px; }
.preview-section p, .preview-section ol, .preview-section ul { margin: 0; } .preview-section ol, .preview-section ul { padding-left: 24px; }
.overview-section { padding-top: 4px; border-top: 0; } .trend-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.trend-card { padding: 14px; border: 1px solid #dbe7f4; border-radius: 8px; background: #f8fbff; } .trend-card h4 { margin-top: 0; color: #346aa5; }
.limitation-section { color: #657387; }
@media (max-width: 700px) {
  header { flex-direction: column; } header .el-button { width: 100%; } .report-panel { padding: 14px; }
  .report-summary { align-items: stretch; flex-direction: column; } .report-summary .el-button { width: 100%; }
  .preview-meta, .trend-grid { grid-template-columns: 1fr; } .preview-meta .wide { grid-column: auto; }
}
</style>
