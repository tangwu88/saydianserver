<template>
  <view class="gift-detail-overlay" @click.self="emit('close')">
    <view
      ref="dialog"
      class="gift-detail-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="商品详情"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <view class="gift-detail-heading">
        <b>商品详情</b>
        <button
          role="button"
          class="gift-detail-close"
          tabindex="0"
          aria-label="关闭商品详情，返回兑换"
          @click="emit('close')"
          @keydown.enter.prevent="emit('close')"
          @keydown.space.prevent="emit('close')"
        >
          ×
        </button>
      </view>
      <scroll-view scroll-y class="gift-detail-content">
        <view v-if="loading" class="gift-detail-state" role="status"
          >正在加载商品详情…</view
        >
        <view v-else-if="error" class="gift-detail-state" role="alert">
          <text>{{ error }}</text>
          <button role="button" class="outline-btn" @click="load">
            重新加载
          </button>
        </view>
        <view v-else-if="product" class="gift-detail-body">
          <h2>{{ product.displayName || product.name || title }}</h2>
          <text v-if="product.subtitle" class="gift-detail-subtitle">{{
            product.subtitle
          }}</text>
          <CatalogImage
            v-for="(image, index) in images"
            :key="image"
            class="gift-detail-image"
            :source="image"
            :alt="product.displayName || product.name || title"
            :width="960"
            sizes="(max-width: 640px) 100vw, 700px"
            :priority="index === 0"
          />
          <ProductDescription
            v-if="product.detailHtml"
            :html="product.detailHtml"
          />
          <text v-else class="gift-detail-state">暂无更多商品详情</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>
<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { api } from "../api";
import CatalogImage from "./CatalogImage.vue";
import ProductDescription from "./ProductDescription.vue";

const props = defineProps<{ productId: string; title: string }>();
const emit = defineEmits<{ close: [] }>();
const product = ref<any>(null),
  loading = ref(true),
  error = ref("");
const dialog = ref<any>();
const images = computed<string[]>(() => [
  ...new Set<string>(
    [product.value?.coverImage, ...(product.value?.gallery || [])].filter(
      (image): image is string => typeof image === "string" && !!image,
    ),
  ),
]);
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  product.value = null;
  try {
    const value = await api(
      "/storefront/products/" + encodeURIComponent(props.productId),
    );
    if (current === generation) product.value = value;
  } catch {
    if (current === generation) error.value = "商品详情暂时无法加载，请重试。";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => props.productId, load, { immediate: true });
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  // #ifdef H5
  if (event.key !== "Tab") return;
  const root = event.currentTarget as HTMLElement;
  const targets = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [role="button"]:not([disabled]), a[href], [tabindex="0"]',
    ),
  ).filter((el) => el.getClientRects().length);
  const first = targets[0],
    last = targets[targets.length - 1];
  if (
    !first ||
    (event.shiftKey &&
      (document.activeElement === first || document.activeElement === root))
  ) {
    event.preventDefault();
    (last || root).focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  // #endif
}
// #ifdef H5
let previousFocus: HTMLElement | null = null,
  previousOverflow: string | undefined;
onMounted(async () => {
  previousFocus = document.activeElement as HTMLElement | null;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  await nextTick();
  const root = dialog.value?.$el || dialog.value;
  root?.querySelector('button, [role="button"]')?.focus();
});
// #endif
onBeforeUnmount(() => {
  generation++;
  // #ifdef H5
  if (previousOverflow !== undefined)
    document.body.style.overflow = previousOverflow;
  if (previousFocus?.isConnected) previousFocus.focus();
  // #endif
});
</script>
<style scoped>
.gift-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  background: rgba(16, 26, 24, 0.52);
}
.gift-detail-dialog {
  width: 760px;
  max-width: 100%;
  height: 85vh;
  height: 85dvh;
  max-height: 900px;
  background: white;
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.15);
}
.gift-detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 12px 16px 12px 24px;
  border-bottom: 1px solid var(--line);
  font-size: 18px;
}
.gift-detail-close {
  width: 44px;
  min-width: 44px;
  height: 44px;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 30px;
  line-height: 42px;
}
.gift-detail-close::after {
  border: 0;
}
.gift-detail-content {
  flex: 1;
  height: 0;
  min-height: 0;
  width: 100%;
}
.gift-detail-body {
  padding: 24px;
  overflow-wrap: anywhere;
}
.gift-detail-body h2 {
  margin: 0 0 12px;
  font-size: 22px;
  line-height: 1.5;
}
.gift-detail-subtitle {
  display: block;
  margin-bottom: 20px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--muted);
}
.gift-detail-image {
  display: block;
  width: 100%;
  margin-bottom: 18px;
  border-radius: 12px;
  overflow: hidden;
}
.gift-detail-state {
  display: grid;
  gap: 18px;
  padding: 36px 20px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}
.gift-detail-state button {
  margin: 0 auto;
  min-height: 44px;
}
@media (max-width: 640px) {
  .gift-detail-overlay {
    align-items: flex-end;
    padding: 0;
  }
  .gift-detail-dialog {
    width: 100%;
    height: 90vh;
    height: 90dvh;
    max-height: none;
    border-radius: 20px 20px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    box-sizing: border-box;
  }
  .gift-detail-heading {
    padding-left: 18px;
  }
  .gift-detail-body {
    padding: 18px 16px;
  }
  .gift-detail-body h2 {
    font-size: 19px;
  }
}
</style>
