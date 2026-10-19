<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, readableError, responseData } from "../api";
import CnHealthSetting from "./CnHealthSetting.vue";
import CnModuleSetting from "./CnModuleSetting.vue";

type Setting = { key: string; value?: any; updatedAt?: string | null };
const props = defineProps<{ settings: Setting[] }>();
const emit = defineEmits<{ saved: [] }>();
const settings = ref<Record<string, Setting>>(
  Object.fromEntries(props.settings.map((setting) => [setting.key, setting])),
);
const aiKey = "cn_app_display";
const healthKey = "cn_health_display";
const moduleKey = "cn_module_display";
const activeTab = ref("ai");
const ai = ref({
  hideAi: settings.value[aiKey]?.value?.hideAi === true,
  sleepAiEnabled: settings.value[aiKey]?.value?.sleepAiEnabled === true,
});
const busy = ref(false);
const refreshing = ref<Record<string, boolean>>({});
let alive = true;
onBeforeUnmount(() => {
  alive = false;
});

async function refresh(key: string) {
  if (!alive || refreshing.value[key]) return;
  refreshing.value = { ...refreshing.value, [key]: true };
  try {
    const rows = responseData<unknown>(await api.get("/settings"));
    const current = Array.isArray(rows)
      ? (rows.find((row: Setting) => row.key === key) as Setting | undefined)
      : undefined;
    if (!current || !current.updatedAt) throw new Error("设置回读不完整");
    if (!alive) return;
    // Refresh only the saved section: other tabs may contain unsaved edits.
    settings.value = { ...settings.value, [key]: current };
    if (key === aiKey) {
      ai.value = {
        hideAi: current.value?.hideAi === true,
        sleepAiEnabled: current.value?.sleepAiEnabled === true,
      };
    }
  } catch {
    if (alive)
      ElMessage.warning(
        "配置已保存，最新状态读取失败，请关闭并重新打开设置后再编辑该项",
      );
  } finally {
    refreshing.value = { ...refreshing.value, [key]: false };
  }
  if (alive) emit("saved");
}

async function saveAi() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.patch(`/settings/${aiKey}`, {
      value: { ...ai.value },
      public: true,
    });
    if (!alive) return;
    ElMessage.success("AI 显示配置已保存");
    await refresh(aiKey);
  } catch (error) {
    if (alive) ElMessage.error(readableError(error));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section aria-label="赛电健康 功能设置">
    <p class="section-note">选择下方页签调整配置，每项单独保存。</p>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="AI 显示" name="ai">
        <el-alert
          title="仅控制赛电健康中文版安卓、iOS和鸿蒙，不影响 Say Ring、Health 或原赛电。需新版客户端。"
          type="info"
          :closable="false"
        />
        <el-form-item label="隐藏 AI 内容">
          <el-switch
            v-model="ai.hideAi"
            :disabled="busy"
            active-text="隐藏"
            inactive-text="显示"
          />
        </el-form-item>
        <el-form-item label="睡眠 AI 分析">
          <el-switch
            v-model="ai.sleepAiEnabled"
            :disabled="busy"
            active-text="启用"
            inactive-text="关闭"
          />
        </el-form-item>
        <el-alert
          title="睡眠 AI 由独立开关控制；开启后仍须会员在 App 主动确认上传及第三方分析。"
          type="info"
          :closable="false"
        />
        <el-button type="primary" :loading="busy" @click="saveAi"
          >保存 AI 显示配置</el-button
        >
      </el-tab-pane>
      <el-tab-pane label="只读健康指标" name="health">
        <div v-loading="refreshing[healthKey]">
          <CnHealthSetting
            :key="settings[healthKey]?.updatedAt ?? 'new'"
            :setting="settings[healthKey] ?? {}"
            @saved="refresh(healthKey)"
          />
        </div>
      </el-tab-pane>
      <el-tab-pane label="百科与商城" name="modules">
        <div v-loading="refreshing[moduleKey]">
          <CnModuleSetting
            :key="settings[moduleKey]?.updatedAt ?? 'new'"
            :setting="settings[moduleKey] ?? {}"
            @saved="refresh(moduleKey)"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.section-note {
  margin: 0 0 16px;
  color: #606266;
}
:deep(.el-alert) {
  margin-bottom: 20px;
}
</style>
