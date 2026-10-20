<template>
  <!-- #ifdef H5 -->
  <div ref="root" class="product-description"><rich-text :nodes="prepared.html" /></div>
  <!-- #endif -->
  <!-- #ifdef MP-WEIXIN -->
  <rich-text :nodes="responsiveProductHtml(html)" />
  <!-- #endif -->
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { responsiveProductHtml } from "../product-rich-text";
import { attachDeferredProductImages, prepareProductDescription } from "../deferred-product-images";
const props = defineProps<{ html: string }>();
const root = ref<HTMLElement>();
const prepared = computed(() => prepareProductDescription(props.html));
let generation = 0, dispose: (() => void) | undefined;
watch(() => props.html, async () => {
  const current = ++generation;
  dispose?.(); dispose = undefined;
  await nextTick();
  if (current === generation && root.value) dispose = attachDeferredProductImages(root.value, prepared.value.images);
}, { immediate: true, flush: "post" });
onBeforeUnmount(() => { generation++; dispose?.(); });
</script>
<style scoped>
.product-description { width: 100%; max-width: 100%; overflow-wrap: anywhere; }
.product-description :deep(img[data-image-failed]) { min-height: 160px; cursor: pointer; color: #657184; }
.product-description :deep(table) { max-width: 100%; }
</style>
