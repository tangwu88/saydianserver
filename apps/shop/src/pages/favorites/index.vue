<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view class="section-title">我的收藏</view
      ><view v-if="products.length" class="product-grid"
        ><ProductCard
          v-for="product in products"
          :key="product.id"
          :product="product"
          @open="open" /></view
      ><view v-else class="empty card">暂未收藏商品</view></view
    ></view
  >
</template>
<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import ProductCard from "../../components/ProductCard.vue";
import { api, toast } from "../../api";
const products = ref<any[]>([]);
onShow(async () => {
  products.value=[];
  try {
    products.value = await api("/storefront/favorites", { auth: true });
  } catch (e) {
    toast(e);
  }
});
function open(id: string) {
  uni.navigateTo({ url: `/pages/product/index?id=${id}` });
}
</script>
