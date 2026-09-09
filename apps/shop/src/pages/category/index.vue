<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view class="category-layout"
        ><scroll-view scroll-y class="category-nav"
          ><view
            :class="['category-item', !selected && 'active']"
            @click="select('')"
            >全部商品</view
          ><view
            v-for="item in categories"
            :key="item.id"
            :class="['category-item', selected === item.id && 'active']"
            @click="select(item.id)"
            >{{ item.name }}</view
          ></scroll-view
        ><view class="category-main"
          ><view class="category-head"
            ><text>{{ currentName }}</text
            ><text class="small">{{ total }} 件商品</text></view
          ><view v-if="products.length" class="product-grid"
            ><ProductCard
              v-for="product in products"
              :key="product.id"
              :product="product"
              @open="openProduct"
              @buy="buyNow" /></view
          ><view v-else class="empty">{{ busy ? '正在加载…' : '当前分类暂无已上架商品' }}</view><button v-if="products.length < total" class="outline-btn" :disabled="busy" @click="load(true)">加载更多</button></view
        ></view
      ></view
    ></view
  >
  <StoreFooter />
</template>
<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import ProductCard from "../../components/ProductCard.vue";
import StoreFooter from "../../components/StoreFooter.vue";
import { api, toast } from "../../api";
const busy=ref(false);let page=1,revision=0;
const categories = ref<any[]>([]),
  products = ref<any[]>([]),
  selected = ref(""),
  total = ref(0);
const currentName = computed(
  () =>
    categories.value.find((x) => x.id === selected.value)?.name || "全部商品",
);
onShow(async () => {
  try {
    const boot: any = await api("/storefront/bootstrap");
    categories.value = boot.categories;
    const stored = String(uni.getStorageSync("saidian-category-selected") || "");
    if (uni.getStorageInfoSync().keys.includes("saidian-category-selected") && !stored) selected.value = "";
    if (stored && categories.value.some((item) => item.id === stored))
      selected.value = stored;
    uni.removeStorageSync("saidian-category-selected");
    await load();
  } catch (e) {
    toast(e);
  }
});
async function load(more=false) {
  const request=++revision, next=more?page+1:1;
  busy.value=true;
  const categoryQuery = selected.value
    ? `&categoryId=${encodeURIComponent(selected.value)}`
    : "";
  try{const data: any = await api(`/storefront/products?page=${next}&pageSize=24${categoryQuery}`);
    if(request!==revision)return;
    products.value = more ? [...products.value,...data.items] : data.items;
    total.value = data.total;page=next;
  }catch(e){toast(e);}finally{if(request===revision)busy.value=false;}
}
async function select(id: string) {
  selected.value = id;
  try {
    await load();
  } catch (e) {
    toast(e);
  }
}
function openProduct(id: string) {
  uni.navigateTo({ url: `/pages/product/index?id=${id}` });
}
function buyNow(product: any) { uni.navigateTo({url:'/pages/product/index?id='+encodeURIComponent(product.id)}); }
</script>
<style scoped lang="scss">
.category-layout {
  display: grid;
  grid-template-columns: 180rpx 1fr;
  min-height: 75vh;
  background: #fff;
  border-radius: 22rpx;
  overflow: hidden;
}
.category-nav {
  height: 75vh;
  background: #f4f7fb;
}
.category-item {
  padding: 32rpx 12rpx;
  text-align: center;
  color: #5f6d69;
  font-size: 25rpx;
  border-left: 7rpx solid transparent;
}
.category-item.active {
  background: #fff;
  color: var(--green);
  font-weight: 800;
  border-left-color: var(--green);
}
.category-main {
  padding: 28rpx 20rpx;
}
.category-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}
.category-head text {
  font-size: 32rpx;
  font-weight: 850;
}
.category-head .small {
  color: var(--muted);
}
@media (min-width: 900px) {
  .category-layout {
    grid-template-columns: 220px 1fr;
    border-radius: 20px;
  }
  .category-nav {
    height: 720px;
  }
  .category-item {
    padding: 20px;
    font-size: 15px;
  }
  .category-main {
    padding: 32px;
  }
  .category-main .product-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
