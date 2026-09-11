<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { api, readableError, responseData } from "../api";

defineProps<{ modelValue: string | null | undefined }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

function choose(): void { input.value?.click(); }

async function upload(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file || uploading.value) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    ElMessage.error("请选择不超过10MB的 JPG、PNG 或 WebP 图片");
    return;
  }
  uploading.value = true;
  try {
    const body = new FormData();
    body.append("file", file);
    const result = responseData<{ url: string }>(await api.post("/content-images", body));
    if (!result?.url) throw new Error("上传响应缺少图片地址");
    emit("update:modelValue", result.url);
    ElMessage.success("封面图片已上传");
  } catch (error) {
    ElMessage.error(readableError(error));
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="content-image-field">
    <el-input :model-value="modelValue || ''" clearable placeholder="上传图片或填写 HTTPS 地址" @update:model-value="emit('update:modelValue', String($event))">
      <template #append><el-button :loading="uploading" @click="choose">上传图片</el-button></template>
    </el-input>
    <input ref="input" class="file-input" type="file" accept="image/jpeg,image/png,image/webp" @change="upload" />
    <el-image v-if="modelValue" :src="modelValue" fit="cover" class="cover-preview"><template #error><div class="preview-error">图片无法预览</div></template></el-image>
    <p>支持 JPG、PNG、WebP，单张不超过10MB。</p>
  </div>
</template>

<style scoped>
.content-image-field { width: 100%; }
.file-input { display: none; }
.cover-preview { width: 180px; height: 112px; margin-top: 10px; border: 1px solid #e4e7ed; border-radius: 6px; background: #f5f7fa; }
.preview-error { display: grid; width: 100%; height: 100%; place-items: center; color: #909399; font-size: 12px; }
p { margin: 5px 0 0; color: #909399; font-size: 12px; }
</style>
