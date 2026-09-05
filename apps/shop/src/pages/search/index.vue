<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view class="searchbar"
        ><input
          v-model="keyword"
          confirm-type="search"
          placeholder="搜索商品名称、型号"
          @confirm="search"
        /><view @click="search">搜索</view></view
      ><view class="sorts"
        ><text :class="sort === '' && 'active'" @click="setSort('')">综合</text
        ><text :class="sort === 'sales' && 'active'" @click="setSort('sales')"
          >销量</text
        ></view
      ><view v-if="products.length" class="product-grid"
        ><ProductCard
          v-for="product in products"
          :key="product.id"
          :product="product"
          @open="open"
          @buy="buyNow" /></view
      ><view v-else class="empty">输入关键词查找赛电商品</view></view
    ></view
  >
</template>
<script setup lang="ts">
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import ProductCard from "../../components/ProductCard.vue";
import { api, toast } from "../../api";
const keyword = ref(""),
  sort = ref(""),
  products = ref<any[]>([]);
async function search() {
  try {
    const r: any = await api(
      `/storefront/products?keyword=${encodeURIComponent(keyword.value)}&sort=${sort.value}`,
    );
    products.value = r.items;
  } catch (e) {
    toast(e);
  }
}
function setSort(v: string) {
  sort.value = v;
  void search();
}
function open(id: string) {
  uni.navigateTo({ url: `/pages/product/index?id=${id}` });
}
function buyNow(product: any) {
  if (!product.defaultSku) return open(product.id);
  uni.setStorageSync("checkout-items", [
    {
      skuId: product.defaultSku.id,
      quantity: 1,
      sku: product.defaultSku,
      product: {
        id: product.id,
        name: product.name,
        displayName: product.name,
        coverImage: product.coverImage,
      },
    },
  ]);
  uni.navigateTo({ url: "/pages/checkout/index" });
}
</script>
<style scoped lang="scss">
.searchbar {
  height: 88rpx;
  display: flex;
  background: #fff;
  border: 2rpx solid var(--line);
  border-radius: 14rpx;
  overflow: hidden;
  margin-bottom: 24rpx;
}
.searchbar input {
  flex: 1;
  padding: 0 30rpx;
}
.searchbar view {
  width: 140rpx;
  background: var(--green);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.sorts {
  display: flex;
  gap: 42rpx;
  margin: 28rpx 12rpx;
}
.sorts text {
  color: var(--muted);
}
.sorts .active {
  color: var(--green);
  font-weight: 800;
}
@media (min-width: 900px) {
  .searchbar {
    height: 50px;
    max-width: 760px;
    margin: 10px auto 34px;
  }
  .searchbar view {
    width: 120px;
  }
}
</style>
