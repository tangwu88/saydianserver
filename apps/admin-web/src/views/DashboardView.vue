<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, readableError, responseData } from "../api";

const data = ref<Record<string, number>>({});
const labels: Record<string, string> = {
  members: "有效会员", healthRecords: "健康记录", activeCare: "生效关爱",
  warnings: "预警事件", openFeedback: "待处理反馈", outboxPending: "待投递事件",
  products: "商城商品", commerceOrders: "商城订单", paidCents: "成功支付金额（元）",
  healthReports: "健康报告", paymentFailures: "支付失败记录",
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
      <el-col v-for="(value, key) in data" :key="key" :xs="24" :sm="12" :lg="8">
        <el-card style="margin-bottom: 16px"><div class="muted">{{ labels[key] || key }}</div><div class="metric">{{ value == null ? '未获取' : key === 'paidCents' ? (value / 100).toFixed(2) : value }}</div><small v-if="key === 'paidCents'" class="muted">当前成功状态支付记录汇总，不等同历史营收或退款后净销售额</small></el-card>
      </el-col>
    </el-row>
    <el-alert title="健康数据默认只显示摘要；查看原始记录需要健康数据审计权限，并会留下审计日志。" type="info" :closable="false" />
  </section>
</template>
<style scoped>.metric { font-size: 34px; font-weight: 700; margin-top: 10px; }</style>
