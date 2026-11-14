<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { adminSessionKey, api } from "../api";
const props = defineProps<{ conversationId: string; attachmentId: string }>();
const url = ref(""),
  error = ref(false),
  busy = ref(false);
const abort = new AbortController();
async function show() {
  if (busy.value || url.value) return;
  busy.value = true;
  error.value = false;
  const owner = adminSessionKey();
  try {
    const response = await api.get(
      `/support-chat/conversations/${props.conversationId}/attachments/${props.attachmentId}`,
      { responseType: "blob", signal: abort.signal },
    );
    if (
      !abort.signal.aborted &&
      adminSessionKey() === owner &&
      response.data instanceof Blob &&
      response.data.type === "image/jpeg"
    )
      url.value = URL.createObjectURL(response.data);
  } catch {
    if (!abort.signal.aborted) error.value = true;
  } finally {
    busy.value = false;
  }
}
onBeforeUnmount(() => {
  abort.abort();
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>
<template>
  <el-image
    v-if="url"
    :src="url"
    style="width: 140px; max-width: 100%; max-height: 140px"
    fit="contain"
    :preview-src-list="[url]"
    preview-teleported
    alt="会话照片"
  />
  <el-button v-else size="small" plain :loading="busy" @click="show">{{
    error ? "重试读取照片" : "查看照片"
  }}</el-button>
</template>
