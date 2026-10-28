<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref } from "vue";
import { api, data, errorMessage, partnerTokenKey } from "../api";
const emit = defineEmits<{ ready: [value: boolean]; logout: [] }>();
const required = ref(false),
  loading = ref(false),
  error = ref("");
const form = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});
async function load() {
  emit("ready", false);
  loading.value = true;
  error.value = "";
  try {
    const profile = data<{ mustChangePassword: boolean }>(
      await api.get("/auth/me"),
    );
    required.value = profile.mustChangePassword === true;
    emit("ready", !required.value);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
async function save() {
  if (loading.value) return;
  error.value = "";
  if (!form.currentPassword) {
    error.value = "请输入管理员提供的当前密码";
    return;
  }
  if (
    form.newPassword.length < 10 ||
    new TextEncoder().encode(form.newPassword).length > 72
  ) {
    error.value = "新密码至少10个字符，最多72个字节（中文通常占3个字节）";
    return;
  }
  if (form.newPassword !== form.confirmPassword) {
    error.value = "两次输入的新密码不一致";
    return;
  }
  if (form.newPassword === form.currentPassword) {
    error.value = "新密码不能与当前密码相同";
    return;
  }
  loading.value = true;
  try {
    const result = data<{ token: string }>(
      await api.post("/auth/change-password", { ...form }),
    );
    sessionStorage.setItem(partnerTokenKey, result.token);
    Object.assign(form, {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    required.value = false;
    emit("ready", true);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  window.addEventListener("partner-password-change-required", load);
  void load();
});
onBeforeUnmount(() => {
  window.removeEventListener("partner-password-change-required", load);
});
</script>
<template>
  <div v-if="error && !required" class="panel" role="alert">
    {{ error }} <el-button @click="load">重试</el-button
    ><el-button @click="emit('logout')">退出登录</el-button>
  </div>
  <el-dialog
    :model-value="required"
    title="请修改初始密码"
    width="min(480px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
  >
    <p>首次登录或密码已由管理员重置，请先设置您自己的密码。</p>
    <form @submit.prevent="save">
      <el-form label-position="top">
        <el-form-item label="当前密码"
          ><el-input
            v-model="form.currentPassword"
            type="password"
            show-password
            autocomplete="current-password"
            :disabled="loading"
        /></el-form-item>
        <el-form-item label="新密码"
          ><el-input
            v-model="form.newPassword"
            type="password"
            show-password
            autocomplete="new-password"
            :disabled="loading"
            placeholder="至少10个字符，最多72个字节"
        /></el-form-item>
        <el-form-item label="确认新密码"
          ><el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            autocomplete="new-password"
            :disabled="loading"
        /></el-form-item>
      </el-form>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        role="alert"
      />
      <p class="muted">如忘记密码，请联系管理员重置。</p>
      <div class="actions">
        <el-button :disabled="loading" @click="emit('logout')"
          >退出登录</el-button
        ><el-button type="primary" native-type="submit" :loading="loading"
          >保存密码并继续</el-button
        >
      </div>
    </form>
  </el-dialog>
</template>
<style scoped>
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 20px;
}
.muted {
  line-height: 1.7;
  margin-top: 16px;
}
</style>
