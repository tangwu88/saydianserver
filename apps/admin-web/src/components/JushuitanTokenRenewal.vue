<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { api, adminSessionKey, getAdminRoles, responseData, readableError } from "../api";
const state = ref<Record<string, any>>({}), busy = ref(false), error = ref(""), open = ref(false);
const enabled = ref(false), issuedAt = ref(""), expiresAt = ref(""), accessToken = ref(""), refreshToken = ref("");
const editable = getAdminRoles().some(role => ["SUPER_ADMIN", "INTEGRATION_ADMIN"].includes(role));
const endpoint = "/commerce-jobs/token-renewal";
let disposed = false;
function clearSecrets() { accessToken.value = ""; refreshToken.value = ""; }
onBeforeUnmount(() => { disposed = true; clearSecrets(); });
function time(value: unknown) { return value ? new Date(String(value)).toLocaleString("zh-CN") : "未配置"; }
async function load() {
 const session = adminSessionKey();
 try { const result = responseData<Record<string, any>>(await api.get(endpoint)); if (!disposed && session === adminSessionKey()) { state.value = result; enabled.value = !!result.enabled; } }
 catch (cause) { if (!disposed && session === adminSessionKey()) error.value = readableError(cause); }
}
async function save() {
 if(busy.value) return;
 busy.value = true; error.value = ""; const session = adminSessionKey();
 try {
  const pair = accessToken.value || refreshToken.value;
  const body = { enabled: enabled.value, ...(enabled.value && pair ? { accessToken: accessToken.value, refreshToken: refreshToken.value, issuedAt: new Date(issuedAt.value).toISOString(), expiresAt: new Date(expiresAt.value).toISOString() } : {}) };
  const result = responseData<Record<string, any>>(await api.put(endpoint, body));
  if (!disposed && session === adminSessionKey()) { state.value = result; open.value = false; }
 } catch(cause) { if (!disposed && session === adminSessionKey()) error.value = readableError(cause); }
 finally { clearSecrets(); busy.value = false; }
}
onMounted(load);
</script>
<template>
 <el-card shadow="never" style="margin-bottom:16px">
  <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><strong>聚水潭 Token 自动续期</strong><el-tag :type="state.enabled ? 'success' : 'info'">{{ state.enabled ? '已启用' : '未启用' }}</el-tag><el-button @click="load">刷新状态</el-button><el-button v-if="editable" @click="open = !open; clearSecrets()">配置续期</el-button></div>
  <p>{{ state.message || '正在读取续期状态…' }}</p>
  <p>令牌到期：{{ time(state.expiresAt) }}　下次续期：{{ state.enabled ? time(state.nextAttemptAt) : '未安排' }}　最近成功：{{ time(state.renewedAt) }}</p>
  <p v-if="error" role="alert" style="color:var(--el-color-danger)">{{ error }}</p>
  <el-form v-if="open && editable" label-position="top" @submit.prevent="save">
   <el-alert :closable="false" title="使用同次授权返回的访问令牌和刷新令牌。按到期前3天续期，获取后至少16天才允许刷新；已过期或续期结果不明时停止自动刷新。" type="info" />
   <el-form-item label="启用自动续期"><el-switch v-model="enabled" :disabled="busy" /></el-form-item>
   <template v-if="enabled">
    <el-form-item label="新的 access_token（首次配置或重新授权时填写，两种令牌均不回显）"><el-input v-model="accessToken" type="password" autocomplete="new-password" :disabled="busy" /></el-form-item>
    <el-form-item label="同次授权的 refresh_token"><el-input v-model="refreshToken" type="password" autocomplete="new-password" :disabled="busy" /></el-form-item>
    <el-form-item label="这对新令牌的实际获取时间"><input v-model="issuedAt" type="datetime-local" :disabled="busy" /></el-form-item>
    <el-form-item label="这对新令牌的实际到期时间（获取时间加接口返回的 expires_in）"><input v-model="expiresAt" type="datetime-local" :disabled="busy" /></el-form-item>
   </template>
   <el-button type="primary" :loading="busy" @click="save">保存续期配置</el-button>
  </el-form>
 </el-card>
</template>
