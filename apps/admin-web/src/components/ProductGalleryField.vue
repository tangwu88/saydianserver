<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, responseData } from "../api";
import { uploadImageBatch } from "../image-batch";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string]; uploading: [value: boolean] }>();
const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const images = computed(() => [...new Set((props.modelValue || "").split(/\r?\n/).map(url => url.trim()).filter(Boolean))]);
function change(values: string[]): void { emit("update:modelValue", values.join("\n")); }
function remove(index: number): void { change(images.value.filter((_, position) => position !== index)); }
function move(index: number, offset: number): void {
  const values = [...images.value];
  const next = index + offset;
  if (next < 0 || next >= values.length) return;
  [values[index], values[next]] = [values[next]!, values[index]!];
  change(values);
}
async function upload(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files || []);
  target.value = "";
  if (uploading.value || !files.length) return;
  if (images.value.length + files.length > 20) { ElMessage.error("轮播图最多20张，请减少选择数量"); return; }
  uploading.value = true;
  emit("uploading", true);
  const values = [...images.value];
  try {
    const result = await uploadImageBatch(files, async file => {
      const body = new FormData(); body.append("file", file);
      return responseData<{ url: string }>(await api.post("/commerce-images", body)).url;
    }, url => { if (!values.includes(url)) values.push(url); change([...values]); });
    if (result.uploaded) ElMessage.success(`已上传${result.uploaded}张，保存商品后生效`);
    if (result.failures.length) ElMessage.error(result.failures.join("；"));
  } finally { uploading.value = false; emit("uploading", false); }
}
</script>

<template>
  <div class="gallery-field">
    <el-button :loading="uploading" @click="input?.click()">批量上传轮播图</el-button>
    <input ref="input" type="file" multiple accept="image/jpeg,image/png,image/webp" hidden @change="upload" />
    <p>最多20张，支持 JPG、PNG、WebP，单张不超过10MB；可调整展示顺序。</p>
    <div class="gallery-previews">
      <div v-for="(url, index) in images" :key="url" class="gallery-item">
        <el-image :src="url" fit="contain" :preview-src-list="images" :initial-index="index" />
        <div>
          <el-button size="small" :disabled="uploading || index === 0" @click="move(index, -1)">前移</el-button>
          <el-button size="small" :disabled="uploading || index === images.length - 1" @click="move(index, 1)">后移</el-button>
          <el-button size="small" type="danger" :disabled="uploading" @click="remove(index)">删除</el-button>
        </div>
      </div>
    </div>
    <el-input :model-value="modelValue" :disabled="uploading" type="textarea" :rows="3" placeholder="也可填写图片地址，每行一张" @update:model-value="emit('update:modelValue', String($event))" />
  </div>
</template>

<style scoped>
.gallery-field { width: 100%; }
p { color: #909399; font-size: 12px; }
.gallery-previews { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.gallery-item { padding: 8px; border: 1px solid #e4e7ed; border-radius: 6px; }
.gallery-item .el-image { width: 180px; height: 130px; display: block; margin-bottom: 8px; background: #f5f7fa; }
.gallery-item .el-button + .el-button { margin-left: 4px; }
</style>
