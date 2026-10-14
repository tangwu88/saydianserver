<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { api, data, errorMessage } from "../api";
const emit = defineEmits<{ ready: [value: boolean]; logout: [] }>();
const agreement = ref<any>(),
  visible = ref(false),
  checked = ref(false),
  loading = ref(false),
  error = ref("");
async function load() {
  emit("ready", false);
  loading.value = true;
  checked.value = false;
  error.value = "";
  try {
    const result = data(await api.get("/agreement"));
    agreement.value = result.agreement;
    visible.value = !!result.agreement && !result.accepted;
    emit("ready", !visible.value);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
async function accept() {
  if (!checked.value || loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    await api.post("/agreement/accept", {
      agreementId: agreement.value.id,
      contentSha256: agreement.value.contentSha256,
      agreed: true,
    });
    visible.value = false;
    emit("ready", true);
  } catch (cause) {
    error.value = errorMessage(cause);
    await load();
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  window.addEventListener("partner-agreement-required", load);
  void load();
});
onBeforeUnmount(() =>
  window.removeEventListener("partner-agreement-required", load),
);
</script>
<template>
  <div v-if="error && !visible" class="panel" role="alert">
    {{ error }} <el-button @click="load">重试</el-button
    ><el-button @click="emit('logout')">退出登录</el-button>
  </div>
  <el-dialog
    :model-value="visible"
    :title="agreement?.title || '合作协议'"
    width="min(760px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    class="partner-agreement-dialog"
  >
    <p class="muted">版本 {{ agreement?.version }}</p>
    <article class="agreement-content">{{ agreement?.content }}</article>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template #footer
      ><div class="agreement-actions">
        <el-checkbox v-model="checked">我已阅读并同意合作协议</el-checkbox>
        <div>
          <el-button @click="emit('logout')">暂不同意，退出</el-button
          ><el-button
            type="primary"
            :loading="loading"
            :disabled="!checked"
            @click="accept"
            >同意并进入</el-button
          >
        </div>
      </div></template
    >
  </el-dialog>
</template>
<style scoped>
.agreement-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 55dvh;
  overflow: auto;
  font-size: 15px;
  line-height: 1.9;
  padding: 12px 0;
}
.agreement-actions {
  display: grid;
  gap: 12px;
  text-align: left;
}
.agreement-actions > div {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 600px) {
  .agreement-content {
    max-height: 52dvh;
  }
  .agreement-actions > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .agreement-actions .el-button {
    margin: 0;
    min-height: 44px;
  }
}
</style>
