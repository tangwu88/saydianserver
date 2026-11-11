<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";
const labels: Record<string, string> = {
  bloodPressure: "血压",
  bloodOxygen: "血氧",
  heartRate: "心率",
  pulse: "脉搏分析",
  scheduledBP: "定时血压",
};
type Row = { feature: string; enabled: boolean; revision: string | null };
const rows = ref<Row[]>([]),
  busy = ref(false),
  message = ref("");
async function load() {
  rows.value = (await api.get("/settings/sayheath/features")).data.data.items;
}
onMounted(() => {
  load().catch(() => {});
});
async function change(r: Row) {
  if (busy.value) return;
  busy.value = true;
  message.value = "";
  try {
    await api.post("/settings/sayheath/features/" + r.feature, {
      release: "1.0.0+1",
      enabled: !r.enabled,
      expectedRevision: r.revision,
    });
  } catch {
    message.value = "未保存，请刷新后重试。";
  } finally {
    try {
      await load();
    } finally {
      busy.value = false;
    }
  }
}
</script>
<template>
  <el-card v-if="rows.length" header="SayHeath · iOS 1.0.0（1）"
    ><p>对本版本的所有用户生效。开启后仍需用户同意和设备支持。</p>
    <div v-for="r in rows" :key="r.feature">
      <el-switch
        :model-value="r.enabled"
        :disabled="busy"
        :aria-label="labels[r.feature]"
        @change="change(r)"
      />
      {{ labels[r.feature] }}
    </div>
    <p role="status">{{ message }}</p></el-card
  >
</template>
