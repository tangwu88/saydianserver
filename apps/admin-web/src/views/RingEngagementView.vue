<script setup lang="ts">
import { onMounted, ref } from "vue";
import { adminSessionKey, api, responseData } from "../api";

const summary = ref<{ usage?: {shares:number;reacted:number;accepted:number;replied:number};
  reports: {id:string;kind:string;reportedAt:string}[] }>();
const busy = ref(false);
const error = ref(false);
async function load() {
  busy.value = true;
  error.value = false;
  const session = adminSessionKey();
  try {
    const result = responseData<NonNullable<typeof summary.value>>(await api.get("/ring-engagement"));
    if (adminSessionKey() === session) summary.value = result;
  } catch { if (adminSessionKey() === session) error.value = true; }
  finally { busy.value = false; }
}
async function remove(id: string) {
  const session = adminSessionKey();
  try { await api.delete(`/ring-engagement/reports/${id}`); if (adminSessionKey() === session) await load(); }
  catch { if (adminSessionKey() === session) error.value = true; }
}
onMounted(load);
</script>
<template>
  <section v-loading="busy">
    <h1>分享与关爱</h1>
    <el-alert v-if="error" title="暂未成功，请刷新重试。" type="error" :closable="false" />
    <el-descriptions v-if="summary?.usage" :column="2" border>
      <el-descriptions-item label="当前有效分享">{{ summary.usage.shares }}</el-descriptions-item>
      <el-descriptions-item label="收到回应的分享">{{ summary.usage.reacted }}</el-descriptions-item>
      <el-descriptions-item label="近 30 天接受的邀请">{{ summary.usage.accepted }}</el-descriptions-item>
      <el-descriptions-item label="接受后 7 天内互相问候">{{ summary.usage.replied }}</el-descriptions-item>
    </el-descriptions>
    <h2>待处理举报</h2>
    <el-table :data="summary?.reports ?? []">
      <el-table-column prop="reportedAt" label="举报时间" />
      <el-table-column prop="kind" label="消息类型" />
      <el-table-column label="处理">
        <template #default="{ row }">
          <el-popconfirm title="移除这条被举报的消息？" @confirm="remove(row.id)">
            <template #reference><el-button>移除消息</el-button></template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>
