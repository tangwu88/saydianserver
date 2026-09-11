<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { api } from "../api";
const props = defineProps<{ saleId: string; references: unknown }>();
const ids = computed(() => Array.isArray(props.references) ? [...new Set(props.references.filter((value: unknown): value is string => typeof value === "string" && /^file:[a-f0-9-]{36}$/i.test(value)).map((value: string) => value.slice(5)))].slice(0, 9) : []);
const images = ref<{ id: string; url: string }[]>([]), loading = ref(false), error = ref("");
let revision = 0, abort: AbortController | undefined;
const adminSession = () => sessionStorage.getItem("saydian-global-admin-token");
function reset() { revision++; abort?.abort(); abort=undefined; for (const image of images.value) URL.revokeObjectURL(image.url); images.value=[]; loading.value=false; error.value=""; }
watch(() => [props.saleId, JSON.stringify(props.references)], reset);
onBeforeUnmount(reset);
async function load() {
  if (loading.value) return;
  reset(); const request=revision, saleId=props.saleId, session=adminSession();
  if (!session || !/^[a-f0-9-]{36}$/i.test(saleId) || !ids.value.length) return;
  loading.value=true; abort=new AbortController();
  try {
    for (const id of ids.value) {
      const response = await api.get(`/commerce-after-sales/${encodeURIComponent(saleId)}/evidence/${encodeURIComponent(id)}`, { responseType: "blob", signal: abort.signal });
      if (request!==revision || props.saleId!==saleId || adminSession()!==session) return;
      const blob=response.data;
      if (!(blob instanceof Blob) || !["image/jpeg","image/png","image/webp"].includes(blob.type) || blob.size<1 || blob.size>10*1024*1024) throw new Error("图片响应格式无效");
      images.value.push({id,url:URL.createObjectURL(blob)});
    }
  } catch { if (request===revision && adminSession()===session) error.value="图片暂时无法读取，请检查权限或稍后重试。"; }
  finally { if (request===revision) {loading.value=false;if(adminSession()!==session)reset();} }
}
</script>
<template>
  <section v-if="ids.length" class="evidence">
    <h3>售后图片</h3><el-button :loading="loading" @click="load">{{ images.length ? '重新读取图片' : `查看图片（${ids.length}）` }}</el-button>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="pictures"><el-image v-for="image in images" :key="image.id" :src="image.url" :preview-src-list="images.map(item=>item.url)" fit="contain" /></div>
  </section>
</template>
<style scoped>.evidence{margin-top:20px}.pictures{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.pictures .el-image{width:132px;height:132px;border:1px solid #eee}.evidence p{color:#a82435}</style>
