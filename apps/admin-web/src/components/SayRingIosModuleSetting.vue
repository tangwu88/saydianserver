<script setup lang="ts">
import { ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { sayRingIosModuleDisplayOrClosed, sayRingIosModuleSettingKey, sayRingModuleKeys } from "@saydian/app-contracts";
import { api, readableError } from "../api";

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
    if (rollback) await api.post(`/settings/${sayRingIosModuleSettingKey}/rollback`, payload);
    else await api.patch(`/settings/${sayRingIosModuleSettingKey}`, payload);
    ElMessage.success(rollback ? "已恢复上次配置" : "模块显示配置已保存");
    emit("saved");
  } catch (error) { ElMessage.error(readableError(error)); }
  finally { busy.value = false; }
}
</script>

<template>
  <section aria-label="Say Ring 三端模块显示设置">
    <el-alert title="iOS、安卓、鸿蒙共用此配置，所有用户一致；默认隐藏，最多 5 分钟刷新。客户端须升级至支持三端配置的版本。" type="info" :closable="false" />
    <el-form-item v-for="key in sayRingModuleKeys" :key="key" :label="labels[key]">
      <el-switch v-model="value.modules[key]" :disabled="busy" active-text="显示" inactive-text="隐藏" />
    </el-form-item>
    <p>控制三端百科与商城的入口和浏览。显示开关本身不开放购买、支付、医疗、AI或测量权限；各端已具备的能力与服务端授权继续独立校验。</p>
    <el-button type="primary" :loading="busy" @click="save(false)">保存模块配置</el-button>
    <el-button :disabled="busy || !setting.updatedAt" @click="save(true)">恢复上次配置</el-button>
  </section>
</template>
