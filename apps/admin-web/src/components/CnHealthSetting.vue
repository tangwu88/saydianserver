<script setup lang="ts">
import { ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { sayRingIosHealthDisplayOrClosed, sayRingReadOnlyMetricKeys } from "@saydian/app-contracts";
import { api, readableError } from "../api";

const cnHealthKey = "cn_health_display";
const props = defineProps<{ setting: { value?: unknown; updatedAt?: string | null } }>();
const emit = defineEmits<{ saved: [] }>();
const value = ref(sayRingIosHealthDisplayOrClosed(props.setting.value));
const busy = ref(false);
const labels = { heart_rate: "心率", hrv: "HRV", blood_oxygen: "血氧", body_temperature: "皮肤温度", stress: "压力" };
async function save(rollback = false) {
  if (busy.value) return;
  if (rollback) {
    try { await ElMessageBox.confirm("恢复到上次保存前的只读指标配置？不会改变 AI、上传权限或其他 App。", "恢复上次配置", { type: "warning" }); }
    catch { return; }
  }
  busy.value = true;
  try {
    const payload = { expectedUpdatedAt: props.setting.updatedAt ?? null, value: value.value, public: true };
    if (rollback) await api.post(`/settings/${cnHealthKey}/rollback`, payload);
    else await api.patch(`/settings/${cnHealthKey}`, payload);
    ElMessage.success(rollback ? "已恢复上次配置" : "只读指标配置已保存");
    emit("saved");
  } catch (error) { ElMessage.error(readableError(error)); }
  finally { busy.value = false; }
}
</script>

<template>
  <section aria-label="赛电健康（安卓/iOS/鸿蒙） 只读指标设置">
    <el-alert title="仅影响支持此配置的 赛电健康（安卓/iOS/鸿蒙）。默认关闭；所有用户使用相同规则，最多 5 分钟后刷新。" type="info" :closable="false" />
    <el-form-item v-for="key in sayRingReadOnlyMetricKeys" :key="key" :label="labels[key]">
      <el-switch v-model="value.metrics[key]" :disabled="busy" active-text="只读展示" inactive-text="关闭" />
    </el-form-item>
    <p>只控制真实记录的读取、展示与趋势。不开放生理数据云上传、手动测量、医疗预警、疾病风险或 AI。</p>
    <el-button type="primary" :loading="busy" @click="save(false)">保存只读配置</el-button>
    <el-button :disabled="busy || !setting.updatedAt" @click="save(true)">恢复上次配置</el-button>
  </section>
</template>
