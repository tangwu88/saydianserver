<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, readableError, responseData } from "../api";

const data = ref<Record<string, number>>({});
const labels: Record<string, string> = {
  members: "有效会员", healthRecords: "健康记录", activeCare: "生效关爱",
  warnings: "预警事件", openFeedback: "待处理反馈", outboxPending: "待投递事件",
};
onMounted(async () => {
  try { data.value = responseData(await api.get("/dashboard")); }
  catch (error) { ElMessage.error(readableError(error)); }
});
</script>

<template>
  <section class="page">
    <h1 class="page-title">运行概览</h1>
    <el-row :gutter="16">
      <el-col v-for="(value, key) in data" :key="key" :span="8">
        <el-card style="margin-bottom: 16px"><div class="muted">{{ labels[key] || key }}</div><div class="metric">{{ value }}</div></el-card>
      </el-col>
    </el-row>
    <el-alert title="健康数据默认只显示摘要；查看原始记录需要健康数据审计权限，并会留下审计日志。" type="info" :closable="false" />
  </section>
</template>
<style scoped>.metric { font-size: 34px; font-weight: 700; margin-top: 10px; }</style>
