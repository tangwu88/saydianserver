<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view class="category-layout"
        ><view class="category-nav" role="tablist" aria-label="商品分类"
          ><button
            role="tab" :aria-selected="!selected"
            :class="['category-item', !selected && 'active']"
            @click="select('')"
            >全部商品</button
          ><button
            v-for="item in categories"
            :key="item.id"
            role="tab" :aria-selected="selected === item.id"
            :class="['category-item', selected === item.id && 'active']"
            @click="select(item.id)"
            >{{ item.name }}</button
          ></view
        ><view class="category-main"
          ><view class="category-head"
            ><text>{{ currentName }}</text
            ><text class="small">{{ total }} 件商品</text></view
          ><view v-if="error" class="error-state" role="alert"><text>{{ error }}</text><button class="outline-btn" :disabled="busy" @click="retry">重新加载</button></view
          ><view v-if="products.length" class="product-grid"
            ><ProductCard
              v-for="product in products"
              :key="product.id"
              :product="product"
              @open="openProduct"
              @buy="buyNow" /></view
          ><view v-else-if="!error" class="empty">{{ busy ? '正在加载…' : '当前分类暂无已上架商品' }}</view><button v-if="!error && products.length < total" class="outline-btn" :disabled="busy" @click="load(true)">加载更多</button></view
        ></view
      ></view
    ></view
  >
  <StoreFooter />
</template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
import { onShow } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import ProductCard from "../../components/ProductCard.vue";
import StoreFooter from "../../components/StoreFooter.vue";
import { api } from "../../api";
const busy=ref(false), error=ref('');let page=1,revision=0,failedMore=false,bootstrapFailed=false;
const categories = ref<any[]>([]),
  products = ref<any[]>([]),
  selected = ref(""),
  total = ref(0);
const currentName = computed(
  () =>
    categories.value.find((x) => x.id === selected.value)?.name || "全部商品",
);
onShow(initialize);
async function initialize() {
  const request=++revision;
  busy.value=true;error.value='';bootstrapFailed=false;
  try {
    const boot: any = await api("/storefront/bootstrap");
    if(request!==revision)return;
    categories.value = boot.categories;
    const stored = String(mallStorage.get("saidian-category-selected") || "");
    if (mallStorage.has("saidian-category-selected"))
      selected.value = categories.value.some((item) => item.id === stored) ? stored : "";
    else if (!categories.value.some((item) => item.id === selected.value)) selected.value = "";
    mallStorage.remove("saidian-category-selected");
    await load();
  } catch (e) {
    if(request!==revision)return;
    products.value=[];total.value=0;bootstrapFailed=true;
    error.value=e instanceof Error ? e.message : '分类暂时无法加载，请重试';
    busy.value=false;
  }
}
async function load(more=false) {
  const request=++revision, next=more?page+1:1;
  busy.value=true;error.value='';failedMore=more;
  if(!more){products.value=[];total.value=0;}
  const categoryQuery = selected.value
    ? `&categoryId=${encodeURIComponent(selected.value)}`
    : "";
  try{const data: any = await api(`/storefront/products?page=${next}&pageSize=24${categoryQuery}`);
    if(request!==revision)return;
    products.value = more ? [...products.value,...data.items] : data.items;
    total.value = data.total;page=next;
  }catch(e){if(request===revision)error.value=e instanceof Error ? e.message : '商品暂时无法加载，请重试';}finally{if(request===revision)busy.value=false;}
}
async function select(id: string) {
  selected.value = id;
  await load();
}
function retry(){return bootstrapFailed ? initialize() : load(failedMore);}
function openProduct(id: string) {
  uni.navigateTo({ url: `/pages/product/index?id=${id}` });
}
function buyNow(product: any) { uni.navigateTo({url:'/pages/product/index?id='+encodeURIComponent(product.id)}); }
</script>
<style scoped lang="scss">
.category-layout {
  display: grid;
  grid-template-columns: 160px minmax(0,1fr);
  min-height: 75vh;
  background: #fff;
  border-radius: 22rpx;
  overflow: hidden;
}
.category-nav {
  height: 75vh;
  background: #f4f7fb;
  overflow: auto;
}
.category-item {
  display:block;
  width:100%;
  margin:0;
  border:0;
  border-radius:0;
  background:transparent;
  line-height:1.5;
  min-height:44px;
  padding: 16px 8px;
  text-align: center;
  color: #5f6d69;
  font-size: 14px;
  border-left: 3px solid transparent;
}
.category-item::after {border:0;}
.category-item:focus-visible {outline:2px solid var(--green);outline-offset:-2px;}
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
  font-size: 18px;
  font-weight: 850;
}
.category-head .small {
  color: var(--muted);
  font-size:14px;
  font-weight:400;
  white-space:nowrap;
}
@media (max-width: 599px) {
  .category-layout {display:block;}
  .category-nav {display:flex;height:auto;gap:4px;padding:4px;scrollbar-width:none;}
  .category-nav::-webkit-scrollbar {display:none;}
  .category-item {width:auto;flex:none;white-space:nowrap;padding:10px 14px;font-size:14px;border-left:0;border-bottom:3px solid transparent;}
  .category-item.active {border-bottom-color:var(--green);}
  .category-main {padding:16px 10px;}
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
