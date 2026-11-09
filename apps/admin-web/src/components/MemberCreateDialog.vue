<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { adminSessionKey, api, readableError, responseData } from "../api";
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; created: [] }>();
const mobile = ref("");
const password = ref("");
const busy = ref(false);
const error = ref("");
let disposed = false;
const controller = new AbortController();
function clear() { mobile.value = ""; password.value = ""; error.value = ""; }
watch(() => props.modelValue, clear);
onBeforeUnmount(() => { disposed = true; controller.abort(); clear(); });
async function submit() {
  if (busy.value) return;
  error.value = "";
  if (!mobile.value.trim()) { error.value = "请填写手机号"; return; }
  if (password.value.length < 8 || new TextEncoder().encode(password.value).length > 72) { error.value = "密码须至少8位且不能超过72字节"; return; }
  const session = adminSessionKey();
  if (!session) { error.value = "请先登录后台"; return; }
  busy.value = true;
  try {
    const result = responseData<{ memberNo: string }>(await api.post("/members", { mobile: mobile.value.trim(), password: password.value }, { signal: controller.signal }));
    if (disposed || session !== adminSessionKey()) { clear(); return; }
    clear();
    emit("update:modelValue", false);
    emit("created");
    ElMessage.success(`会员账号已创建，会员编号：${result.memberNo}`);
  } catch (reason) {
    if (!disposed && session === adminSessionKey()) error.value = readableError(reason);
  } finally { busy.value = false; }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="新增会员账号" width="min(480px, 94vw)" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="emit('update:modelValue', $event)">
    <p class="muted">请确认手机号已由管理员核实。创建后可使用手机号和密码登录手表、戒指 App 及商城。</p>
    <el-form label-width="80px" @submit.prevent="submit">
      <el-form-item label="手机号" required><el-input v-model="mobile" aria-label="新会员手机号" autocomplete="off" placeholder="国内11位手机号，国际号码请带区号" :disabled="busy" /></el-form-item>
      <el-form-item label="密码" required><el-input v-model="password" aria-label="新会员密码" type="password" show-password autocomplete="new-password" placeholder="至少8位，最多72字节" :disabled="busy" @keyup.enter="submit" /></el-form-item>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </el-form>
    <template #footer><el-button :disabled="busy" @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="busy" @click="submit">创建账号</el-button></template>
  </el-dialog>
</template>
