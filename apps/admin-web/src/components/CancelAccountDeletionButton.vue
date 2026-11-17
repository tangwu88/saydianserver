<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminSessionKey, api, getAdminRoles, readableError } from "../api";

const props = defineProps<{ request: { id: string; userId: string; status: string; requestedAt: string; user?: { mobile?: string } } }>();
const emit = defineEmits<{ cancelled: [] }>();
const busy = ref(false);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
async function cancel() {
  if (busy.value || props.request.status !== "REQUESTED" || !getAdminRoles().includes("SUPER_ADMIN")) return;
  const session = adminSessionKey();
  if (!session) return;
  const snapshot = { ...props.request };
  busy.value = true;
  try {
    const answer = await ElMessageBox.prompt(
      `请确认会员 ${snapshot.user?.mobile || "（未填写手机号）"} 已明确要求撤销注销。撤销后可重新登录，原资料保留；已开始处理的注销不能撤销。请填写核实原因。`,
      "撤销注销并恢复登录",
      { inputType: "textarea", inputValidator: value => value.trim().length >= 5 && value.trim().length <= 200 || "请填写5至200字的原因", confirmButtonText: "确认撤销", cancelButtonText: "返回" },
    );
    if (disposed || session !== adminSessionKey() || snapshot.id !== props.request.id) return;
    await api.post(`/account-deletions/${snapshot.id}/cancel`, {
      expectedUserId: snapshot.userId, expectedRequestedAt: snapshot.requestedAt, confirm: true, reason: answer.value.trim(),
    });
    if (disposed || session !== adminSessionKey()) return;
    ElMessage.success("注销已撤销，会员可重新登录；原资料和绑定已保留");
    emit("cancelled");
  } catch (error) {
    if (error !== "cancel" && error !== "close" && !disposed && session === adminSessionKey()) ElMessage.error(readableError(error));
  } finally { busy.value = false; }
}
</script>

<template>
  <el-button v-if="getAdminRoles().includes('SUPER_ADMIN')" size="small" type="warning" plain :loading="busy" :disabled="request.status !== 'REQUESTED'" @click="cancel">撤销注销</el-button>
</template>
