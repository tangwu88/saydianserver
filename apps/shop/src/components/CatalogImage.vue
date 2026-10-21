<template>
  <view ref="root" class="catalog-image" :class="{ 'catalog-image--cover': cover }">
    <!-- #ifdef H5 -->
    <img v-if="enabled && visible && !unavailable" :src="displaySource" :srcset="fallback || width === 160 ? '' : catalogImageSet(source) || ''" :sizes="sizes || '(min-width: 900px) 560px, 100vw'" :alt="alt || '商品图片'" :loading="priority ? 'eager' : 'lazy'" :fetchpriority="priority ? 'high' : 'low'" decoding="async" @error="failed" @click="$emit('click')" />
    <!-- #endif -->
    <!-- #ifdef MP-WEIXIN -->
    <image v-if="enabled && !unavailable" :src="displaySource" :lazy-load="!priority" :mode="cover ? 'aspectFill' : 'aspectFit'" @error="failed" @click="$emit('click')" />
    <!-- #endif -->
    <button v-if="unavailable" class="image-retry" @click.stop="retry">图片未加载，点击重试</button>
  </view>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { catalogImageSet, catalogImageSource, observeCatalogImage, type CatalogImageWidth } from "../catalog-image";
const props = withDefaults(defineProps<{ source: string; width?: CatalogImageWidth; sizes?: string; alt?: string; enabled?: boolean; priority?: boolean; cover?: boolean; defer?: boolean }>(), {
  width: 960, sizes: "(min-width: 900px) 560px, 100vw", alt: "商品图片", enabled: true, priority: false, cover: false, defer: false,
});
defineEmits<{ click: [] }>();
const fallback = ref(false), unavailable = ref(false);
const visible = ref(true), root = ref<Element | { $el: Element }>();
let generation = 0, dispose: (() => void) | undefined;
const displaySource = computed(() => fallback.value ? props.source : catalogImageSource(props.source, props.width));
function failed() {
  if (!fallback.value && displaySource.value !== props.source) fallback.value = true;
  else unavailable.value = true;
}
function retry() { unavailable.value = false; fallback.value = false; }
watch(() => props.source, retry);
watch(() => [props.source, props.enabled, props.defer, props.priority], async () => {
  const current = ++generation;
  dispose?.(); dispose = undefined;
  // #ifdef H5
  visible.value = !props.defer || props.priority;
  if (!props.enabled || visible.value) return;
  await nextTick();
  if (current !== generation || !root.value) return;
  const element = "$el" in root.value ? root.value.$el : root.value;
  dispose = observeCatalogImage(element, () => { visible.value = true; });
  // #endif
}, { immediate: true, flush: "post" });
onBeforeUnmount(() => { generation++; dispose?.(); });
</script>
<style scoped>
.catalog-image { position: relative; display: block; overflow: hidden; background: #f5f6f8; }
.catalog-image img, .catalog-image image { display: block; width: 100%; height: 100%; object-fit: contain; }
.catalog-image--cover img { object-fit: cover; }
.image-retry { position: absolute; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 12px; border: 0; background: #f5f6f8; color: #657184; font-size: 13px; white-space: normal; }
</style>
