<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type {
  HealthScoreRuleVersion,
  HealthScoreRules,
  HealthScoreResult,
} from "@saydian/app-contracts";
import { api, getAdminRoles, responseData, readableError } from "../api";
const items = ref<HealthScoreRuleVersion[]>([]),
  enabled = ref(false),
  busy = ref(false),
  error = ref(""),
  editor = ref<HealthScoreRuleVersion | null>(null),
  preview = ref<HealthScoreResult | null>(null),
  previewMember = ref(""),
  previewDays = ref(7),
  reviewed = ref(false),
  dirty = ref(false);
const writable = computed(() => getAdminRoles().includes("SUPER_ADMIN")),
  editable = computed(() => writable.value && editor.value?.status === "DRAFT");
const metrics = [
  ["heart_rate", "心率"],
  ["systolic", "收缩压"],
  ["diastolic", "舒张压"],
  ["blood_oxygen", "血氧"],
  ["sleep_minutes", "整夜睡眠时长"],
  ["steps", "日步数"],
  ["distance", "日距离"],
  ["calories", "日活动热量"],
  ["temperature_skin", "皮温"],
  ["temperature_estimated_body", "估算体温"],
  ["hrv_sdnn", "HRV SDNN"],
  ["hrv_rmssd", "HRV RMSSD"],
];
const origins = [
  ["watch_history", "设备历史"],
  ["app_measurement", "App 测量"],
  ["remote_member", "关爱测量"],
  ["manual_entry", "手动记录"],
  ["imported", "导入记录"],
];
const fresh = () => {
  dirty.value = true;
  reviewed.value = false;
  preview.value = null;
};
async function load() {
  busy.value = true;
  error.value = "";
  try {
    const result = responseData<{
      enabled: boolean;
      items: HealthScoreRuleVersion[];
    }>(await api.get("/health-score-rules"));
    items.value = result.items;
    enabled.value = result.enabled;
  } catch (e) {
    error.value = readableError(e);
  } finally {
    busy.value = false;
  }
}
async function create(copy?: HealthScoreRules) {
  busy.value = true;
  try {
    const row = responseData<HealthScoreRuleVersion>(
      await api.post("/health-score-rules", copy ? { rules: copy } : {}),
    );
    await load();
    open(row);
  } catch (e) {
    error.value = readableError(e);
  } finally {
    busy.value = false;
  }
}
function open(row: HealthScoreRuleVersion) {
  editor.value = JSON.parse(JSON.stringify(row));
  fresh();
  dirty.value = false;
}
async function save() {
  if (!editor.value) return;
  busy.value = true;
  error.value = "";
  try {
    editor.value = responseData(
      await api.post("/health-score-rules", {
        id: editor.value.id,
        rules: editor.value.rules,
      }),
    );
    await load();
    dirty.value = false;
    reviewed.value = false;
    preview.value = null;
    ElMessage.success("草稿已保存，尚未发布");
  } catch (e) {
    error.value = readableError(e);
  } finally {
    busy.value = false;
  }
}
async function publish() {
  if (!editor.value || !reviewed.value || dirty.value) return;
  try {
    await ElMessageBox.confirm(
      `发布第 ${editor.value.version} 版评分规则后，新的大屏将按此版本计算；旧分析保留原版本。确认已核对依据、适用范围和预览结果？`,
      "发布评分规则",
      { type: "warning" },
    );
  } catch {
    return;
  }
  busy.value = true;
  try {
    editor.value = responseData(
      await api.post(`/health-score-rules/${editor.value.id}/publish`, {
        reviewed: true,
        expectedUpdatedAt: editor.value.updatedAt,
      }),
    );
    await load();
    ElMessage.success("规则已发布");
  } catch (e) {
    error.value = readableError(e);
  } finally {
    busy.value = false;
  }
}
async function toggle() {
  try {
    await ElMessageBox.confirm(
      enabled.value
        ? "关闭后会员大屏和新分析将暂不可用。已有数据保留。"
        : "开放后，有权限的管理员和战略伙伴可查看会员大屏。评分仍须单独发布。",
      "调整健康大屏开放状态",
    );
  } catch {
    return;
  }
  try {
    enabled.value = responseData<{ enabled: boolean }>(
      await api.post("/health-score-rules/settings", {
        enabled: !enabled.value,
      }),
    ).enabled;
  } catch (e) {
    error.value = readableError(e);
  }
}
async function runPreview() {
  if (!editor.value || dirty.value) return;
  busy.value = true;
  error.value = "";
  try {
    preview.value = responseData<{ score: HealthScoreResult }>(
      await api.post(
        `/health-score-rules/${editor.value.id}/preview`,
        { memberId: previewMember.value, days: previewDays.value },
        { timeout: 50000 },
      ),
    ).score;
  } catch (e) {
    error.value = readableError(e);
  } finally {
    busy.value = false;
  }
}
function addItem() {
  if (!editor.value) return;
  const pair = metrics.find(
    ([key]) => !editor.value!.rules.items.some((i) => i.key === key),
  );
  if (!pair) return;
  editor.value.rules.items.push({
    key: pair[0]!,
    label: pair[1]!,
    weight: 1,
    required: true,
    minDays: 3,
    minSamples: 3,
    minAge: 18,
    maxAge: null,
    gender: "ANY",
    allowedOrigins: ["watch_history", "app_measurement"],
    bands: [],
    basis: "",
    referenceUrl: "",
  });
  fresh();
}
onMounted(load);
</script>
<template>
  <section class="page score-rule-page">
    <header class="rule-heading">
      <div>
        <h1>健康评分规则</h1>
        <p>先编辑草稿、预览并审核，再发布生效。评分只作健康管理参考。</p>
      </div>
      <div>
        <el-tag :type="enabled ? 'success' : 'info'"
          >大屏{{ enabled ? "已开放" : "未开放" }}</el-tag
        ><el-button v-if="writable" @click="toggle">{{
          enabled ? "关闭大屏" : "开放大屏"
        }}</el-button
        ><el-button
          v-if="writable"
          type="primary"
          :disabled="busy"
          @click="create()"
          >新增规则草稿</el-button
        >
      </div>
    </header>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
    /><el-alert
      title="来源、单位或指标定义待核实的记录不进入评分；缺失项不会记零或自动重分配权重。默认草稿不含未经审核的评分区间。"
      type="info"
      :closable="false"
    />
    <el-table :data="items" v-loading="busy"
      ><el-table-column
        prop="version"
        label="版本"
        width="80"
      /><el-table-column label="名称"
        ><template #default="{ row }">{{
          row.rules.title
        }}</template></el-table-column
      ><el-table-column label="状态" width="110"
        ><template #default="{ row }"
          ><el-tag :type="row.status === 'PUBLISHED' ? 'success' : 'info'">{{
            row.status === "PUBLISHED"
              ? "已发布"
              : row.status === "ARCHIVED"
                ? "历史版本"
                : "草稿"
          }}</el-tag></template
        ></el-table-column
      ><el-table-column label="操作" width="220"
        ><template #default="{ row }"
          ><el-button @click="open(row)">{{
            row.status === "DRAFT" && writable ? "编辑" : "查看"
          }}</el-button
          ><el-button v-if="writable" @click="create(row.rules)"
            >复制为草稿</el-button
          ></template
        ></el-table-column
      ></el-table
    >
    <el-empty
      v-if="!items.length && !busy"
      description="尚无评分规则；大屏会显示“评分规则待发布”"
    />
    <el-drawer
      :model-value="!!editor"
      @close="editor = null"
      title="评分规则详情"
      size="min(100%, 1080px)"
      :close-on-click-modal="false"
      ><template v-if="editor"
        ><el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
        /><el-form label-position="top" @input="fresh" :disabled="!editable"
          ><div class="rule-two">
            <el-form-item label="规则名称"
              ><el-input
                v-model="editor.rules.title"
                maxlength="120" /></el-form-item
            ><el-form-item label="版本状态"
              ><el-input
                :model-value="`第${editor.version}版 · ${editor.status}`"
                disabled
            /></el-form-item>
          </div>
          <el-form-item label="说明与适用边界"
            ><el-input
              v-model="editor.rules.description"
              type="textarea"
              :rows="2"
              maxlength="2000"
          /></el-form-item>
          <article
            v-for="(item, index) in editor.rules.items"
            :key="index"
            class="rule-item"
          >
            <header>
              <h3>{{ item.label }}</h3>
              <el-button
                v-if="editable"
                type="danger"
                text
                @click="
                  editor.rules.items.splice(index, 1);
                  fresh();
                "
                >移除此项</el-button
              >
            </header>
            <div class="rule-grid">
              <el-form-item label="指标"
                ><el-select v-model="item.key" @change="fresh"
                  ><el-option
                    v-for="[key, label] in metrics"
                    :key="key"
                    :label="label"
                    :value="key" /></el-select></el-form-item
              ><el-form-item label="显示名称"
                ><el-input v-model="item.label" /></el-form-item
              ><el-form-item label="权重（0表示仅看分项）"
                ><el-input-number
                  v-model="item.weight"
                  :min="0"
                  :max="100"
                  @change="fresh" /></el-form-item
              ><el-form-item label="必需指标"
                ><el-switch
                  v-model="item.required"
                  @change="fresh" /></el-form-item
              ><el-form-item label="最少覆盖天数"
                ><el-input-number
                  v-model="item.minDays"
                  :min="1"
                  :max="90"
                  @change="fresh" /></el-form-item
              ><el-form-item label="最少符合条件记录"
                ><el-input-number
                  v-model="item.minSamples"
                  :min="1"
                  :max="100000"
                  @change="fresh" /></el-form-item
              ><el-form-item label="最低年龄（空表示不限）"
                ><el-input-number
                  v-model="item.minAge"
                  :min="0"
                  :max="130"
                  :value-on-clear="null"
                  @change="fresh" /></el-form-item
              ><el-form-item label="最高年龄（空表示不限）"
                ><el-input-number
                  v-model="item.maxAge"
                  :min="0"
                  :max="130"
                  :value-on-clear="null"
                  @change="fresh" /></el-form-item
              ><el-form-item label="适用性别"
                ><el-select v-model="item.gender" @change="fresh"
                  ><el-option label="不限" value="ANY" /><el-option
                    label="男"
                    value="MALE" /><el-option
                    label="女"
                    value="FEMALE" /></el-select
              ></el-form-item>
            </div>
            <el-form-item label="允许的测量来源（仍需通过数据质量检查）"
              ><el-checkbox-group v-model="item.allowedOrigins" @change="fresh"
                ><el-checkbox
                  v-for="[key, label] in origins"
                  :key="key"
                  :value="key"
                  >{{ label }}</el-checkbox
                ></el-checkbox-group
              ></el-form-item
            >
            <h4>评分区间：包含下限，不包含上限</h4>
            <p class="rule-help">
              边界留空表示无下限／上限。每项取符合条件的每日值平均；日累计值采用该日最新有效汇总。
            </p>
            <div v-for="(band, b) in item.bands" :key="b" class="band-row">
              <el-input-number
                v-model="band.min"
                placeholder="下限"
                :value-on-clear="null"
                @change="fresh"
              /><span>至</span
              ><el-input-number
                v-model="band.max"
                placeholder="上限"
                :value-on-clear="null"
                @change="fresh"
              /><span>得分</span
              ><el-input-number
                v-model="band.score"
                :min="0"
                :max="100"
                @change="fresh"
              /><el-button
                v-if="editable"
                text
                type="danger"
                @click="
                  item.bands.splice(b, 1);
                  fresh();
                "
                >删除</el-button
              >
            </div>
            <el-button
              v-if="editable"
              @click="
                item.bands.push({ min: null, max: null, score: 0 });
                fresh();
              "
              >添加区间</el-button
            >
            <el-form-item label="评分依据、测量方式与适用限制"
              ><el-input
                v-model="item.basis"
                type="textarea"
                :rows="3"
                maxlength="4000" /></el-form-item
            ><el-form-item label="依据来源（HTTPS链接）"
              ><el-input
                v-model="item.referenceUrl"
                placeholder="https://…"
                maxlength="1000"
            /></el-form-item>
          </article>
          <el-button v-if="editable" @click="addItem"
            >添加指标</el-button
          ></el-form
        >
        <section class="rule-preview">
          <h3>使用会员数据预览已保存规则</h3>
          <p class="rule-help">
            只在当前会话预览，不发布规则、不调用 AI，也不扣次数。请先保存草稿。
          </p>
          <div class="rule-two">
            <el-input
              v-model="previewMember"
              placeholder="会员 UUID（从会员详情或大屏地址获取）"
            /><el-select v-model="previewDays"
              ><el-option
                v-for="d in [7, 30, 90]"
                :key="d"
                :value="d"
                :label="`近${d}天`"
            /></el-select>
          </div>
          <el-button
            v-if="writable"
            :disabled="busy || dirty || !previewMember"
            @click="runPreview"
            >预览评分</el-button
          >
          <div v-if="preview">
            <p>
              总分：{{ preview.total ?? "暂不可评分" }} · {{ preview.reason }}
            </p>
            <p v-for="item in preview.items" :key="item.key">
              {{ item.label }}：{{ item.score ?? "—" }}；{{
                item.reason ||
                `${item.days}天 / ${item.count}条 / 依据值${item.value}`
              }}
            </p>
          </div>
        </section>
        <div v-if="editable" class="rule-footer">
          <el-button :loading="busy" @click="save">保存草稿</el-button
          ><span v-if="dirty" class="rule-help"
            >有未保存修改，请先保存再预览、审核。</span
          ><el-checkbox v-model="reviewed" :disabled="dirty"
            >已审核评分依据、适用范围和预览结果</el-checkbox
          ><el-button
            type="primary"
            :disabled="busy || dirty || !reviewed"
            @click="publish"
            >发布此版本</el-button
          >
        </div></template
      ></el-drawer
    >
  </section>
</template>
<style scoped>
.score-rule-page {
  padding: 24px;
}
.rule-heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}
.rule-heading h1 {
  margin: 0 0 8px;
}
.rule-heading p,
.rule-help {
  font-size: 13px;
  color: #6d7c90;
  line-height: 1.7;
}
.rule-heading > div:last-child {
  display: flex;
  gap: 10px;
  align-items: center;
}
.el-alert {
  margin-bottom: 16px;
}
.rule-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.rule-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 16px;
}
.rule-item {
  border: 1px solid #dfe6ee;
  border-radius: 12px;
  padding: 18px;
  margin: 18px 0;
}
.rule-item header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rule-item h3 {
  margin: 0 0 14px;
}
.band-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.rule-item h4 {
  margin-bottom: 5px;
}
.rule-item > .el-button {
  margin-bottom: 20px;
}
.rule-footer {
  position: sticky;
  bottom: 0;
  background: white;
  border-top: 1px solid #dfe6ee;
  padding: 16px 0;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.rule-preview {
  background: #f5f8fc;
  padding: 18px;
  border-radius: 12px;
  margin: 20px 0;
}
.rule-preview .el-button {
  margin-top: 12px;
}
@media (max-width: 760px) {
  .rule-heading {
    flex-direction: column;
  }
  .rule-grid,
  .rule-two {
    grid-template-columns: 1fr;
  }
  .score-rule-page {
    padding: 14px;
  }
  .band-row .el-input-number {
    width: 110px;
  }
}
</style>
