<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { sayRingU19HealthOrClosed, sayRingU19HealthSettingKey, u19HealthCeiling, type U19HealthMetric } from "@saydian/app-contracts";
import { api, readableError } from "../api";
const props = defineProps<{ setting: { value?: unknown; updatedAt?: string | null } }>();
const emit = defineEmits<{ saved: [] }>();
const value = ref(sayRingU19HealthOrClosed(props.setting.value));
const busy = ref(false);
const labels = { blood_pressure: "血压", heart_rate: "心率", blood_oxygen: "血氧" };
function change(key: U19HealthMetric, kind: "readMetrics" | "manualMetrics", enabled: unknown) {
  if (kind === "manualMetrics" && enabled === true && !value.value.readMetrics.includes(key)) return;
  value.value[kind] = enabled === true
    ? u19HealthCeiling.filter(item => item === key || value.value[kind].includes(item))
    : value.value[kind].filter(item => item !== key);
  // 关闭读取时同时收回该指标的手动授权，其他项目不变。
  if (kind === "readMetrics" && enabled !== true)
    value.value.manualMetrics = value.value.manualMetrics.filter(item => item !== key);
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.patch(`/settings/${sayRingU19HealthSettingKey}`, {
      expectedUpdatedAt: props.setting.updatedAt ?? null, value: value.value, public: true,
    });
    ElMessage.success("U19 功能配置已保存");
    emit("saved");
  } catch (error) { ElMessage.error(readableError(error)); }
  finally { busy.value = false; }
}
</script>
<template>
  <section aria-label="Say Ring U19 手表健康功能">
    <el-alert title="仅影响支持 U19 的新版 Say Ring iOS；独立于戒指配置，最多 5 分钟刷新。实际功能仍以手表应答为准。" type="info" :closable="false" />
    <div v-for="key in u19HealthCeiling" :key="key" class="u19-metric">
      <strong>{{ labels[key] }}</strong>
      <el-checkbox :model-value="value.readMetrics.includes(key)" :disabled="busy" @change="change(key, 'readMetrics', $event)">读取与趋势</el-checkbox>
      <el-checkbox :model-value="value.manualMetrics.includes(key)" :disabled="busy || !value.readMetrics.includes(key)" @change="change(key, 'manualMetrics', $event)">手动测量</el-checkbox>
    </div>
    <p>保存不改变手表监测开关、语言或时间，不修改旧版戒指功能。</p>
    <el-button type="primary" :loading="busy" @click="save">保存 U19 功能</el-button>
  </section>
</template>
<style scoped>
.u19-metric { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin: 18px 0; }
</style>
