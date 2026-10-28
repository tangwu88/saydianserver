<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { api, readableError, responseData } from "../api";
type Picture = {
  id: string;
  originalName: string;
  createdAt: string;
  url?: string;
  error?: string;
};
const props = defineProps<{ partner: { id: string; name: string } }>();
const emit = defineEmits<{ close: [] }>();
const rows = ref<Picture[]>([]),
  total = ref(0),
  page = ref(1),
  loading = ref(false),
  uploading = ref(false),
  error = ref("");
const pending = ref<File[]>([]),
  uploadResults = ref<Array<{ name: string; error?: string }>>([]);
const pendingPictures = ref<
  Array<{ file: File; url: string; failed: boolean }>
>([]);
const controller = new AbortController();
let request = 0,
  disposed = false;
function release() {
  for (const row of rows.value) if (row.url) URL.revokeObjectURL(row.url);
}
function updatePending(files: File[]) {
  const existing = new Map(
    pendingPictures.value.map((picture) => [picture.file, picture]),
  );
  const kept = new Set(files);
  for (const picture of pendingPictures.value)
    if (!kept.has(picture.file)) URL.revokeObjectURL(picture.url);
  pending.value = files;
  pendingPictures.value = files.map(
    (file) =>
      existing.get(file) || {
        file,
        url: URL.createObjectURL(file),
        failed: false,
      },
  );
}
async function preview(row: Picture, version = request) {
  try {
    const result = await api.get(
      `/partners/${props.partner.id}/customer-images/${row.id}`,
      { responseType: "blob", signal: controller.signal },
    );
    if (disposed || version !== request) return;
    row.url = URL.createObjectURL(result.data);
    row.error = "";
  } catch (cause) {
    if (!disposed && version === request) row.error = readableError(cause);
  }
}
async function load() {
  const version = ++request;
  loading.value = true;
  error.value = "";
  release();
  rows.value = [];
  try {
    const result = responseData<{ items: Picture[]; total: number }>(
      await api.get(`/partners/${props.partner.id}/customer-images`, {
        params: { page: page.value },
        signal: controller.signal,
      }),
    );
    if (disposed || version !== request) return;
    rows.value = result.items;
    total.value = result.total;
    // At most two private image requests at a time.
    const queue = [...rows.value];
    await Promise.all(
      [0, 1].map(async () => {
        let row;
        while ((row = queue.shift())) {
          if (disposed || version !== request) return;
          await preview(row, version);
        }
      }),
    );
  } catch (cause) {
    if (!disposed && version === request) error.value = readableError(cause);
  } finally {
    if (!disposed && version === request) loading.value = false;
  }
}
function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  error.value = "";
  if (files.length > 20) {
    error.value = "每批最多选择20张图片";
    return;
  }
  if (
    files.some(
      (file) =>
        (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
          file.type.toLowerCase(),
        ) &&
          !/\.(jpe?g|png|webp)$/i.test(file.name)) ||
        file.size <= 0 ||
        file.size > 10 * 1024 * 1024,
    )
  ) {
    error.value = "请选择JPG、PNG或WebP图片，每张不超过10MB";
    return;
  }
  updatePending(files);
  uploadResults.value = [];
}
async function upload() {
  if (uploading.value || !pending.value.length) return;
  uploading.value = true;
  const failed: File[] = [];
  uploadResults.value = [];
  try {
    for (const file of pending.value) {
      const body = new FormData();
      body.append("file", file);
      try {
        await api.post(`/partners/${props.partner.id}/customer-images`, body, {
          timeout: 60_000,
        });
        uploadResults.value.push({ name: file.name });
      } catch (cause) {
        failed.push(file);
        uploadResults.value.push({
          name: file.name,
          error: readableError(cause),
        });
      }
    }
    updatePending(failed);
    page.value = 1;
    await load();
  } finally {
    uploading.value = false;
  }
}
onMounted(load);
onBeforeUnmount(() => {
  disposed = true;
  request++;
  controller.abort();
  release();
  updatePending([]);
});
</script>
<template>
  <el-dialog
    :model-value="true"
    :title="`${partner.name} · 客户资料`"
    width="min(960px, 96vw)"
    :close-on-click-modal="!uploading"
    :close-on-press-escape="!uploading"
    :show-close="!uploading"
    @close="emit('close')"
  >
    <p>
      可批量保存客户资料图片，仅总管理员可查看。每批最多20张，每张不超过10MB，每个伙伴最多200张。
    </p>
    <div class="upload-actions">
      <label class="select-images"
        >选择多张图片<input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          :disabled="uploading"
          @change="choose"
      /></label>
      <el-button
        type="primary"
        :disabled="!pending.length"
        :loading="uploading"
        @click="upload"
        >上传并保存（{{ pending.length }}张）</el-button
      >
    </div>
    <p v-if="pending.length">
      待上传：{{ pending.map((file) => file.name).join("、") }}
    </p>
    <div
      v-if="pendingPictures.length"
      class="pictures"
      aria-label="待上传图片预览"
    >
      <article v-for="(picture, index) in pendingPictures" :key="picture.url">
        <el-image
          v-if="!picture.failed"
          :src="picture.url"
          fit="contain"
          :alt="picture.file.name"
          :preview-src-list="
            pendingPictures
              .filter((item) => !item.failed)
              .map((item) => item.url)
          "
          :initial-index="
            pendingPictures.slice(0, index).filter((item) => !item.failed)
              .length
          "
          preview-teleported
          @error="picture.failed = true"
        />
        <div v-else class="placeholder">图片暂时无法预览</div>
        <p>{{ picture.file.name }}</p>
      </article>
    </div>
    <ul v-if="uploadResults.length" aria-live="polite">
      <li v-for="(result, index) in uploadResults" :key="index">
        {{ result.name }}：{{ result.error || "已保存" }}
      </li>
    </ul>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-button v-if="error" @click="load">重新加载</el-button>
    <h3>已保存图片（{{ total }}张）</h3>
    <div v-loading="loading" class="pictures" aria-label="已保存客户资料图片">
      <article v-for="(row, index) in rows" :key="row.id">
        <el-image
          v-if="row.url"
          :src="row.url"
          fit="contain"
          :preview-src-list="
            rows.filter((item) => item.url).map((item) => item.url!)
          "
          :initial-index="
            rows.slice(0, index).filter((item) => item.url).length
          "
          preview-teleported
          :alt="row.originalName"
        />
        <div v-else class="placeholder">
          {{ row.error || "图片加载中"
          }}<el-button v-if="row.error" @click="preview(row)">重试</el-button>
        </div>
        <p>{{ row.originalName }}</p>
        <small>{{ new Date(row.createdAt).toLocaleString() }}</small>
      </article>
    </div>
    <el-empty
      v-if="!loading && !rows.length && !error"
      description="暂无客户资料图片"
    />
    <el-pagination
      v-if="total"
      v-model:current-page="page"
      :page-size="10"
      :total="total"
      layout="prev, pager, next, total"
      :disabled="loading || uploading"
      @current-change="load"
    />
    <template #footer
      ><el-button :disabled="uploading" @click="emit('close')"
        >关闭</el-button
      ></template
    >
  </el-dialog>
</template>
<style scoped>
.upload-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin: 20px 0;
}
.select-images {
  display: grid;
  gap: 8px;
}
.pictures {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 18px;
  margin: 24px 0;
}
.pictures article {
  min-width: 0;
}
.pictures p,
li {
  overflow-wrap: anywhere;
}
.pictures .el-image,
.placeholder {
  width: 100%;
  height: 160px;
  background: #f4f6fa;
}
.pictures small {
  color: #6b7280;
}
.placeholder {
  display: grid;
  place-content: center;
}
</style>
