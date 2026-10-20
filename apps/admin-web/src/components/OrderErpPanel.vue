<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api, readableError, responseData } from "../api";
import { erpOrderStatus } from "../commerce-order-erp";

const props = defineProps<{ order: Record<string, any>; canSync: boolean }>();
const emit = defineEmits<{ synced: [snapshot: Record<string, any>] }>();
const snapshot = ref<Record<string, any>>({ erpStatus: props.order.erpStatus, items: [] });
const expanded = ref(false), busy = ref(false), error = ref("");
let generation = 0, disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); });
onMounted(() => { if (props.canSync && props.order.erpOrderId) void refresh(false); else void load(); });
const endpoint = () => `/commerce-orders/${encodeURIComponent(String(props.order.id))}/erp`;
function current(request: number) { return !disposed && request === generation; }
async function load(request = ++generation, poll = 0): Promise<void> {
  try {
    const result = responseData<Record<string, any>>(await api.get(endpoint()));
    if (!current(request)) return;
    snapshot.value = result;
    if (result.state === "PENDING" && poll < 12) {
      timer = setTimeout(() => { void load(request, poll + 1); }, 2500);
      return;
    }
    if (result.state === "READY") emit("synced", result);
  } catch (cause) { if (current(request)) error.value = readableError(cause); }
  finally { if (current(request)) busy.value = false; }
}
async function refresh(showLogs = true): Promise<void> {
  if (busy.value || disposed) return;
  expanded.value = showLogs || expanded.value; busy.value = true; error.value = "";
  clearTimeout(timer);
  const request = ++generation;
  try {
    if (props.canSync && props.order.erpOrderId) await api.post(endpoint() + "-sync", {});
    if (current(request)) await load(request);
  } catch (cause) { if (current(request)) error.value = readableError(cause); }
  finally { if (current(request)) busy.value = false; }
}
</script>
<template>
  <div class="order-erp-panel">
    <el-button link type="primary" :loading="busy" @click="refresh()">ERP：{{ order.erpOrderId ? erpOrderStatus(snapshot.erpStatus) : '尚未推送' }}</el-button>
    <el-button link size="small" :disabled="busy" @click="refresh()">{{ expanded ? '刷新 ERP 日志' : '获取 ERP 日志' }}</el-button>
    <div v-if="expanded" class="erp-records">
      <p v-if="error" role="alert">{{ error }}</p>
      <small v-if="snapshot.syncedAt">同步于 {{ new Date(snapshot.syncedAt).toLocaleString('zh-CN', { hour12: false }) }}</small>
      <p v-if="snapshot.state === 'PENDING'">正在获取 ERP 状态和日志，若尚未完成可稍后刷新。</p>
      <p v-else-if="snapshot.state === 'ERROR'">同步失败，已保留上次记录。请联系商城运营检查 ERP 任务和接口权限后重试。</p>
      <p v-else-if="snapshot.state === 'UNAVAILABLE'">ERP 服务尚未配置，已保留上次记录。</p>
      <p v-else-if="snapshot.state === 'WAITING_ORDER'">此订单尚未关联可同步的 ERP 订单。</p>
      <p v-else-if="!snapshot.items?.length && !error">ERP 暂无操作日志。</p>
      <el-timeline v-if="snapshot.items?.length">
        <el-timeline-item v-for="event in snapshot.items" :key="event.id" :timestamp="event.time">
          <strong>{{ event.name || '操作记录' }}</strong><span v-if="event.operator"> · {{ event.operator }}</span><p v-if="event.remark">{{ event.remark }}</p>
        </el-timeline-item>
      </el-timeline>
      <p v-if="snapshot.truncated">记录较多，当前显示最近一次同步取得的部分日志。</p>
    </div>
  </div>
</template>
<style scoped>
.order-erp-panel{min-width:0}.erp-records{max-height:340px;overflow:auto;margin-top:12px;overflow-wrap:anywhere}.erp-records p{white-space:pre-wrap;margin:6px 0}.erp-records small{color:#64748b}.erp-records .el-timeline{padding-left:18px;margin-top:16px}
</style>
