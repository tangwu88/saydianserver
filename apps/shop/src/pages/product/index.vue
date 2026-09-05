<template>
  <DesktopHeader /><view v-if="product" class="page"
    ><view class="container product-layout"
      ><view class="gallery"
        ><image
          class="main-image"
          :src="currentImage || productPlaceholder"
          mode="aspectFill" /><scroll-view scroll-x class="thumbs"
          ><image
            v-for="image in images"
            :key="image"
            :class="currentImage === image && 'active'"
            :src="image"
            mode="aspectFill"
            @click="currentImage = image" /></scroll-view></view
      ><view class="product-info card"
        ><view class="tags"
          ><text v-for="tag in product.tags" :key="tag">{{ tag }}</text></view
        ><text class="title">{{ product.displayName || product.name }}</text
        ><text class="subtitle">{{
          product.subtitle || "赛电智能健康穿戴设备"
        }}</text
        ><view class="price-box"
          ><text>{{ money(selectedSku?.salePriceCents) }}</text
          ><del v-if="selectedSku?.marketPriceCents">{{
            money(selectedSku.marketPriceCents)
          }}</del></view
        ><view class="sku-title">选择规格</view
        ><view class="skus"
          ><view
            v-for="sku in product.skus"
            :key="sku.id"
            :class="selectedSku?.id === sku.id && 'active'"
            @click="selectSku(sku)"
            >{{ sku.specification || "默认规格" }}</view
          ></view
        ><view class="stock">库存 {{ selectedSku?.stock || 0 }} 件</view
        ><view class="quantity"
          ><text>数量</text
          ><view
            ><text @click="quantity = Math.max(1, quantity - 1)">−</text
            ><b>{{ quantity }}</b
            ><text @click="quantity += 1">＋</text></view
          ></view
        ><view class="actions"
          ><view class="outline-btn" @click="toggleFavorite">{{
            product.favorite ? "已收藏" : "收藏"
          }}</view
          ><view class="outline-btn" @click="addCart">加入购物车</view
          ><view class="primary-btn" @click="buyNow">立即购买</view></view
        ><view class="service-line"
          >赛电商城 · 在线客服 · 售后进度可查</view
        ></view
      ></view
    ><view class="container detail card"
      ><view class="section-title">商品详情</view
      ><rich-text v-if="product.detailHtml" :nodes="product.detailHtml" /><view
        v-else
        class="empty"
        >暂无更多商品详情</view
      ><view v-if="product.reviews?.length"
        ><view class="section-title">用户评价</view
        ><view v-for="review in product.reviews" :key="review.id" class="review"
          ><b>{{ review.user.nickname }}</b
          ><text
            >{{ "★".repeat(review.rating)
            }}{{ "☆".repeat(5 - review.rating) }}</text
          ><text class="small">{{ review.content }}</text></view
        ></view
      ></view
    ></view
  ><view v-else class="empty">正在加载商品…</view>
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money, productPlaceholder, toast } from "../../api";
import { isLoggedIn } from "../../session";
const product = ref<any>(),
  selectedSku = ref<any>(),
  quantity = ref(1),
  currentImage = ref("");
const images = computed(() => [
  ...new Set(
    [
      product.value?.coverImage,
      ...(product.value?.gallery || []),
      ...(product.value?.skus || []).map((x: any) => x.image),
    ].filter(Boolean),
  ),
]);
onLoad(async (o) => {
  try {
    product.value = await api(`/storefront/products/${o?.id}`);
    selectedSku.value = product.value.skus?.[0];
    currentImage.value = images.value[0] || "";
  } catch (e) {
    toast(e);
  }
});
function selectSku(sku: any) {
  selectedSku.value = sku;
  if (sku.image) currentImage.value = sku.image;
}
function ensure() {
  if (!isLoggedIn()) {
    uni.navigateTo({ url: "/pages/login/index" });
    return false;
  }
  if (!selectedSku.value || selectedSku.value.stock < quantity.value) {
    uni.showToast({ title: "库存不足", icon: "none" });
    return false;
  }
  return true;
}
async function addCart() {
  if (!ensure()) return;
  try {
    await api("/storefront/cart/items", {
      method: "POST",
      auth: true,
      data: { skuId: selectedSku.value.id, quantity: quantity.value },
    });
    uni.showToast({ title: "已加入购物车" });
  } catch (e) {
    toast(e);
  }
}
function buyNow() {
  if (!ensure()) return;
  uni.setStorageSync("checkout-items", [
    {
      skuId: selectedSku.value.id,
      quantity: quantity.value,
      sku: selectedSku.value,
      product: product.value,
    },
  ]);
  uni.navigateTo({ url: "/pages/checkout/index" });
}
async function toggleFavorite() {
  if (!ensure()) return;
  try {
    const enabled = !product.value.favorite;
    await api(`/storefront/favorites/${product.value.id}`, {
      method: "POST",
      auth: true,
      data: { enabled },
    });
    product.value.favorite = enabled;
  } catch (e) {
    toast(e);
  }
}
</script>
<style scoped lang="scss">
.product-layout {
  display: grid;
  gap: 24rpx;
}
.gallery,
.product-info,
.detail {
  min-width: 0;
}
.main-image {
  width: 100%;
  height: 720rpx;
  background: var(--mint);
  border-radius: 24rpx;
}
.thumbs {
  white-space: nowrap;
  margin-top: 16rpx;
}
.thumbs image {
  width: 110rpx;
  height: 110rpx;
  border-radius: 14rpx;
  margin-right: 14rpx;
  border: 4rpx solid transparent;
}
.thumbs image.active {
  border-color: var(--green);
}
.tags {
  display: flex;
  gap: 10rpx;
}
.tags text {
  font-size: 21rpx;
  padding: 6rpx 12rpx;
  color: var(--green);
  background: var(--mint);
  border-radius: 8rpx;
}
.title {
  display: block;
  font-size: 42rpx;
  font-weight: 900;
  line-height: 1.35;
  margin-top: 22rpx;
}
.subtitle {
  display: block;
  color: var(--muted);
  font-size: 25rpx;
  line-height: 1.6;
  margin-top: 12rpx;
}
.price-box {
  margin: 28rpx -28rpx;
  padding: 22rpx 28rpx;
  background: #fff5ef;
}
.price-box text {
  font-size: 48rpx;
  color: #d65f2d;
  font-weight: 900;
}
.price-box del {
  font-size: 24rpx;
  color: #9aa4a1;
  margin-left: 18rpx;
}
.sku-title {
  font-weight: 750;
}
.skus {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin: 18rpx 0;
}
.skus view {
  padding: 16rpx 22rpx;
  border: 1px solid #d8e1df;
  border-radius: 12rpx;
  font-size: 24rpx;
}
.skus .active {
  color: var(--green);
  background: var(--mint);
  border-color: var(--green);
}
.stock {
  color: var(--muted);
  font-size: 22rpx;
}
.quantity {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 28rpx 0;
}
.quantity view {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 12rpx;
  overflow: hidden;
}
.quantity view > * {
  width: 70rpx;
  height: 62rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.quantity b {
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
}
.actions {
  display: grid;
  grid-template-columns: 0.7fr 1fr 1.3fr;
  gap: 14rpx;
}
.service-line {
  text-align: center;
  color: var(--muted);
  font-size: 22rpx;
  margin-top: 26rpx;
}
.detail {
  margin-top: 28rpx;
}
.review {
  padding: 22rpx 0;
  border-top: 1px solid var(--line);
}
.review > text {
  float: right;
  color: #e18a38;
}
.review .small {
  display: block;
  margin-top: 12rpx;
  color: #52615d;
}
@media (min-width: 900px) {
  .product-layout {
    grid-template-columns: 1.05fr 0.95fr;
    gap: 34px;
  }
  .main-image {
    height: 620px;
  }
  .product-info {
    padding: 36px;
  }
  .title {
    font-size: 32px;
  }
  .price-box {
    margin: 24px -36px;
    padding: 20px 36px;
  }
  .price-box text {
    font-size: 36px;
  }
  .detail {
    margin-top: 34px;
  }
  .actions {
    margin-top: 30px;
  }
}
</style>
