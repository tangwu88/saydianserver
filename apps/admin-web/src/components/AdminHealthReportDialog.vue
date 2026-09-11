<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, readableError, responseData } from "../api";
import { healthMetricLabel, healthTime } from "../health-display";

type Trend = { metric: string; text: string };
type Content = { overview: string; trends: Trend[]; suggestions: string[]; limitations: string[] };
type Report = {
  id: string;
  memberId: string;
  member?: { memberNo?: string; nickname?: string };
  status: string;
  updatedAt: string;
  generatedAt?: string | null;
  period?: { from: string; to: string };
  content?: Content;
  limitations?: string[];
  failureReason?: string | null;
};

const props = defineProps<{ modelValue: boolean; row: Record<string, unknown> | null; canEdit: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; saved: [] }>();
const report = ref<Report | null>(null);
const draft = ref<Content>({ overview: "", trends: [], suggestions: [], limitations: [] });
const loading = ref(false);
const saving = ref(false);
const editing = ref(false);
const errorMessage = ref("");
const visible = computed({ get: () => props.modelValue, set: value => emit("update:modelValue", value) });
const statusLabel = computed(() => ({ awaiting_payment: "待获取报告次数", queued: "已排队", generating: "AI 分析中", ready: "已生成", failed: "生成失败", revoked: "已撤销" }[report.value?.status ?? ""] ?? "状态待确认"));
const displayLimitations = computed(() => Array.from(new Set([
  ...(report.value?.content?.limitations ?? []),
  ...(report.value?.limitations ?? []),
].map(value => String(value).trim()).filter(Boolean))));

function copyContent(content: Content): Content {
  return {
    overview: String(content.overview ?? ""),
    trends: (content.trends ?? []).map(item => ({ metric: String(item.metric), text: String(item.text ?? "") })),
    suggestions: (content.suggestions ?? []).map(String),
    limitations: (content.limitations ?? []).map(String),
  };
}

async function load(): Promise<void> {
  const id = String(props.row?.id ?? "");
  if (!id || loading.value) return;
  loading.value = true;
  errorMessage.value = "";
  editing.value = false;
  try {
    const result = responseData<Report>(await api.get(`/health-reports/${encodeURIComponent(id)}`));
    if (!result?.id || result.id !== id) throw new Error("报告返回不完整，请刷新后重试");
    report.value = result;
    if (result.content) draft.value = copyContent(result.content);
  } catch (error) {
    report.value = null;
    errorMessage.value = readableError(error);
  } finally {
    loading.value = false;
  }
}

function beginEdit(): void {
  if (!props.canEdit || report.value?.status !== "ready" || !report.value.content) return;
  draft.value = copyContent(report.value.content);
  editing.value = true;
}

function addSuggestion(): void { if (draft.value.suggestions.length < 20) draft.value.suggestions.push(""); }
function addLimitation(): void { if (draft.value.limitations.length < 20) draft.value.limitations.push(""); }

async function save(): Promise<void> {
  if (!report.value?.content || !report.value.updatedAt || saving.value) return;
  const content = copyContent(draft.value);
  content.overview = content.overview.trim();
  content.trends = content.trends.map(item => ({ ...item, text: item.text.trim() }));
  content.suggestions = content.suggestions.map(value => value.trim()).filter(Boolean);
  content.limitations = content.limitations.map(value => value.trim()).filter(Boolean);
  if (!content.overview || content.trends.some(item => !item.text) || !content.limitations.length) {
    ElMessage.error("请填写健康概览、每项趋势说明，并至少保留一项数据局限");
    return;
  }
  try {
    await ElMessageBox.confirm("保存后会员查看到的报告正文会同步更新，系统会记录本次人工修改。", "确认修改健康报告", {
      type: "warning",
      confirmButtonText: "确认保存",
      cancelButtonText: "取消",
    });
  } catch { return; }
  saving.value = true;
  try {
    const result = responseData<Report>(await api.patch(`/health-reports/${encodeURIComponent(report.value.id)}`, {
      content,
      expectedUpdatedAt: report.value.updatedAt,
    }));
    if (!result?.content) throw new Error("保存响应不完整，请重新打开报告确认");
    report.value = result;
    draft.value = copyContent(result.content);
    editing.value = false;
    ElMessage.success("健康报告已保存并记录审计");
    emit("saved");
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    saving.value = false;
  }
}

watch(() => [props.modelValue, props.row?.id], ([open]) => {
  if (open) void load();
  else { report.value = null; editing.value = false; errorMessage.value = ""; }
});
</script>

<template>
  <el-dialog v-model="visible" title="健康报告" width="min(900px, 94vw)" top="4vh" destroy-on-close :close-on-click-modal="false">
    <div v-loading="loading" class="health-report-dialog">
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon />
      <template v-if="report">
        <el-alert title="健康报告包含敏感健康信息，查看和修改均会写入审计记录；内容仅供日常健康管理参考。" type="warning" :closable="false" show-icon />
        <div class="report-meta">
          <div><span>会员</span><strong>{{ report.member?.nickname || "未填写昵称" }} · {{ report.member?.memberNo ? `会员 ${report.member.memberNo}` : "会员编号未获取" }}</strong></div>
          <div><span>状态</span><strong>{{ statusLabel }}</strong></div>
          <div v-if="report.generatedAt"><span>生成时间</span><strong>{{ healthTime(report.generatedAt, 0) }}</strong></div>
          <div v-if="report.period" class="wide"><span>统计期间</span><strong>{{ healthTime(report.period.from, 0) }} 至 {{ healthTime(report.period.to, 0) }}</strong></div>
        </div>

        <template v-if="report.status === 'ready' && report.content">
          <section class="document-section">
            <h3>健康概览</h3>
            <el-input v-if="editing" v-model="draft.overview" type="textarea" :rows="5" maxlength="2000" show-word-limit />
            <p v-else>{{ report.content.overview }}</p>
          </section>
          <section class="document-section">
            <h3>健康趋势</h3>
            <div class="trend-grid">
              <article v-for="(trend, index) in (editing ? draft.trends : report.content.trends)" :key="trend.metric + index" class="trend-card">
                <h4>{{ healthMetricLabel(trend.metric) }}</h4>
                <el-input v-if="editing" v-model="trend.text" type="textarea" :rows="3" maxlength="500" show-word-limit />
                <p v-else>{{ trend.text }}</p>
              </article>
            </div>
          </section>
          <section class="document-section">
            <div class="section-heading"><h3>日常健康建议</h3><el-button v-if="editing" size="small" @click="addSuggestion">添加建议</el-button></div>
            <template v-if="editing">
              <div v-for="(_, index) in draft.suggestions" :key="index" class="editable-row"><el-input v-model="draft.suggestions[index]" maxlength="500" /><el-button type="danger" plain @click="draft.suggestions.splice(index, 1)">删除</el-button></div>
              <el-empty v-if="!draft.suggestions.length" description="暂无建议，可按需添加" :image-size="56" />
            </template>
            <ol v-else><li v-for="(item, index) in report.content.suggestions" :key="index">{{ item }}</li></ol>
          </section>
          <section class="document-section limitation-section">
            <div class="section-heading"><h3>数据与分析局限</h3><el-button v-if="editing" size="small" @click="addLimitation">添加局限</el-button></div>
            <template v-if="editing"><div v-for="(_, index) in draft.limitations" :key="index" class="editable-row"><el-input v-model="draft.limitations[index]" maxlength="500" /><el-button type="danger" plain :disabled="draft.limitations.length === 1" @click="draft.limitations.splice(index, 1)">删除</el-button></div></template>
            <ul v-else><li v-for="(item, index) in displayLimitations" :key="index">{{ item }}</li></ul>
          </section>
        </template>
        <el-empty v-else :description="report.failureReason || `报告当前为“${statusLabel}”，暂无可查看正文`" :image-size="72" />
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button v-if="report?.status === 'ready' && report.content && canEdit && !editing" type="primary" @click="beginEdit">编辑报告</el-button>
      <template v-if="editing"><el-button :disabled="saving" @click="editing = false">取消编辑</el-button><el-button type="primary" :loading="saving" @click="save">保存修改</el-button></template>
    </template>
  </el-dialog>
</template>

<style scoped>
.health-report-dialog { min-height: 180px; color: #263446; line-height: 1.75; }
.report-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
.report-meta > div { display: flex; flex-direction: column; gap: 3px; padding: 11px 14px; border-radius: 8px; background: #f5f8fc; }
.report-meta .wide { grid-column: 1 / -1; }
.report-meta span { color: #657387; font-size: 12px; }
.report-meta strong { overflow-wrap: anywhere; }
.document-section { padding: 18px 0; border-top: 1px solid #e4eaf2; }
.document-section h3 { margin: 0 0 12px; font-size: 17px; }
.document-section p, .document-section ol, .document-section ul { margin: 0; }
.document-section ol, .document-section ul { padding-left: 24px; }
.trend-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.trend-card { padding: 14px; border: 1px solid #dbe7f4; border-radius: 8px; background: #f8fbff; }
.trend-card h4 { margin: 0 0 8px; color: #346aa5; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.editable-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-bottom: 8px; }
.limitation-section { color: #657387; }
@media (max-width: 700px) { .report-meta, .trend-grid { grid-template-columns: 1fr; } .report-meta .wide { grid-column: auto; } }
</style>
