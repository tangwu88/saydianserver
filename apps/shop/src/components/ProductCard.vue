<template>
  <view class="product-card" @click="$emit('open', product.id)"
    ><image
      class="product-image"
      :src="product.coverImage || productPlaceholder"
      mode="aspectFit"
    /><view class="product-body"
      ><text class="product-name">{{ product.name }}</text
      ><text class="product-subtitle">{{
        product.subtitle || "赛电智能健康穿戴设备"
      }}</text
      ><view class="tag-row"
        ><text
          v-for="tag in product.tags?.slice(0, 2)"
          :key="tag"
          class="tag"
          >{{ tag }}</text
        ></view
      ><view class="price-row"
        ><text class="price">{{ money(product.priceCents) }}</text
        ><text class="sales">库存 {{ product.stock ?? 0 }}</text></view
      ><view class="product-actions"
        ><view class="cart-action" @click.stop="$emit('open', product.id)"
          >查看详情</view
        ><view class="buy-action" @click.stop="$emit('buy', product)"
          >立即购买</view
        ></view
      ></view
    ></view
  >
</template>
<script setup lang="ts">
import { money, productPlaceholder } from "../api";
defineProps<{ product: any }>();
defineEmits<{ open: [id: string]; buy: [product: any] }>();
</script>
<style scoped lang="scss">
.product-actions {
  display: grid;
  grid-template-columns: 1fr 1.7fr;
  gap: 12rpx;
  margin-top: 18rpx;
}
.product-actions > view {
  height: 64rpx;
  border-radius: 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 23rpx;
  font-weight: 700;
}
.cart-action {
  color: var(--ink);
  border: 1px solid var(--line);
}
.buy-action {
  color: #fff;
  background: var(--green);
}
@media (min-width: 900px) {
  .product-actions > view {
    height: 38px;
    font-size: 13px;
  }
}
</style>
