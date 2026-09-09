<template><view class="product-card">
  <view class="product-image-wrap" role="button" tabindex="0" :aria-label="product.name" @click="$emit('open',product.id)" @keydown.enter="$emit('open',product.id)">
    <image v-if="product.coverImage && !imageFailed" class="product-image" :src="product.coverImage" mode="aspectFit" @error="imageFailed=true" /><view v-else class="product-image missing-image">暂无商品图片</view>
  </view><view class="product-body"><text class="product-name" @click="$emit('open',product.id)">{{ product.name }}</text><text v-if="product.subtitle" class="product-subtitle">{{ product.subtitle }}</text>
  <view v-if="product.tags?.length" class="tag-row"><text v-for="tag in product.tags.slice(0,2)" :key="tag" class="tag">{{ tag }}</text></view>
  <view class="price-row"><text class="price">{{ product.priceCents == null ? "价格待确认" : money(product.priceCents) }}</text><text class="sales">{{ product.stock == null ? "库存待确认" : product.stock > 0 ? "有货" : "暂时缺货" }}</text></view>
  <button class="product-buy" @click="$emit('open',product.id)">{{ product.stock === 0 ? "查看详情" : "选择规格" }} <text>→</text></button>
</view></view></template>
<script setup lang="ts">
import { ref } from "vue"; import { money } from "../api";
defineProps<{product:any}>();defineEmits<{open:[id:string];buy:[product:any]}>();const imageFailed=ref(false);
</script>
<style scoped>.product-buy{margin:14px 0 0;display:flex;justify-content:space-between;align-items:center;min-height:44px;line-height:1.4;padding:10px 12px;border-radius:4px;background:var(--green);color:#fff;font-size:14px}.product-buy::after{border:0}.product-image-wrap{cursor:pointer}.missing-image{display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--muted);background:#f7f7f7}</style>
