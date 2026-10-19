<script setup lang="ts">
import { ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { sayRingIosModuleDisplayOrClosed, sayRingModuleKeys } from "@saydian/app-contracts";
import { api, readableError } from "../api";

const cnModuleKey = "cn_module_display";
const props = defineProps<{ setting: { value?: unknown; updatedAt?: string | null } }>();
const emit = defineEmits<{ saved: [] }>();
const value = ref(sayRingIosModuleDisplayOrClosed(props.setting.value));
const busy = ref(false);
const labels = { health_library: "健康百科", mall: "商城" };
async function save(rollback = false) {
  if (busy.value) return;
  if (rollback) {
    try { await ElMessageBox.confirm("恢复上次模块显示配置？不会改变指标、AI、购买或支付权限。", "恢复上次配置", { type: "warning" }); }
    catch { return; }
  }
  busy.value = true;
  try {
    const payload = { expectedUpdatedAt: props.setting.updatedAt ?? null, value: value.value, public: true };
    if (rollback) await api.post(`/settings/${cnModuleKey}/rollback`, payload);
    else await api.patch(`/settings/${cnModuleKey}`, payload);
    ElMessage.success(rollback ? "已恢复上次配置" : "模块显示配置已保存");
    emit("saved");
  } catch (error) { ElMessage.error(readableError(error)); }
  finally { busy.value = false; }
}
</script>

<template>
  <section aria-label="赛电健康（安卓/iOS/鸿蒙） 模块显示设置">
    <el-alert title="所有用户使用同一配置；默认隐藏，最多 5 分钟刷新。仅支持此配置的 赛电健康（安卓/iOS/鸿蒙） 生效。" type="info" :closable="false" />
    <el-form-item v-for="key in sayRingModuleKeys" :key="key" :label="labels[key]">
      <el-switch v-model="value.modules[key]" :disabled="busy" active-text="显示" inactive-text="隐藏" />
    </el-form-item>
    <p>复用现有百科与商城页面，仅控制入口和只读浏览。不开放购买、支付、医疗或一般 AI，不改变五项指标及手动测量授权。</p>
    <el-button type="primary" :loading="busy" @click="save(false)">保存模块配置</el-button>
    <el-button :disabled="busy || !setting.updatedAt" @click="save(true)">恢复上次配置</el-button>
  </section>
</template>
