<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { api, readableError, responseData, setAdminToken, setAdminRoles } from "../api";

const router = useRouter();
const loading = ref(false);
const form = reactive({ username: "", password: "" });

async function submit(): Promise<void> {
  if (!form.username || !form.password) {
    ElMessage.warning("请输入账号和密码");
    return;
  }
  loading.value = true;
  try {
    const result = responseData<{ token: string; user: { role: string; roles?: string[] } }>(
      await api.post("/auth/login", form),
    );
    setAdminToken(result.token);
    setAdminRoles(result.user.roles?.length ? result.user.roles : [result.user.role]);
    await router.replace("/");
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <el-card class="login-card">
      <h1>Saydian赛电</h1>
      <p class="muted">App 管理后台</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="账号"><el-input v-model="form.username" /></el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" :loading="loading" style="width: 100%" @click="submit">登录</el-button>
      </el-form>
    </el-card>
  </main>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; place-items: center; background: linear-gradient(145deg, #f8f9fb, #eceff3); }
.login-card { width: 420px; padding: 18px; }
h1 { color: #c8102e; margin-bottom: 4px; }
</style>
