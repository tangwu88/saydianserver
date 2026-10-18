<template>
  <DesktopHeader/><view class="page"><view class="container">
    <view class="catalog-heading"><view><text class="eyebrow">SAYDIAN COLLECTION</text><h1>选一款，适合自己的。</h1></view><button class="text-button" @click="search">搜索商品 <UniIcons type="search" size="20"/></button></view>
    <view class="category-nav" role="tablist" aria-label="商品分类"><button v-for="item in categories" :key="item.id" role="tab" :aria-selected="selected===item.id" :class="['category-item',selected===item.id && 'active']" @click="select(item.id)">{{ item.name }} <text>{{ count(item.id) }}</text></button></view>
    <view class="catalog-toolbar"><text>{{ total }} 件商品</text><picker :range="sortLabels" :value="sortIndex" @change="sortIndex=Number($event.detail.value)"><view class="sort-picker">{{ sortLabels[sortIndex] }} <UniIcons type="bottom" size="15"/></view></picker></view>
    <view v-if="error" class="error-state" role="alert">{{ error }}<button class="text-button" :disabled="busy" @click="retry">重新加载</button></view>
    <view v-if="busy && !rows.length" class="catalog-skeleton" aria-label="正在加载商品"><view v-for="n in 4" :key="n" class="skeleton-card"/></view>
    <view v-else-if="products.length" class="product-grid"><ProductCard v-for="(product,index) in products" :key="product.id" :product="product" :priority="index<2" @open="openProduct"/></view>
    <view v-else-if="!error" class="empty"><text>暂无相关商品</text><button class="outline-btn" @click="select('all')">查看全部商品</button></view>
  </view></view><StoreFooter/>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import UniIcons from '@dcloudio/uni-ui/lib/uni-icons/uni-icons.vue';
import DesktopHeader from '../../components/DesktopHeader.vue';
import ProductCard from '../../components/ProductCard.vue';
import StoreFooter from '../../components/StoreFooter.vue';
import { mallStorage } from '../../realm';
import { loadCatalog } from '../../catalog-cache';
import { catalogKinds, catalogKind, filterCatalog, type CatalogKind } from '../../catalog-presentation';
const rows=ref<any[]>([]),selected=ref<CatalogKind>('all'),busy=ref(false),error=ref(''),sortIndex=ref(0);
const sorts=['','price_asc','price_desc','sales'],sortLabels=['综合排序','价格从低到高','价格从高到低','销量优先'];
const products=computed(()=>filterCatalog(rows.value,selected.value,'',sorts[sortIndex.value]));
const total=computed(()=>products.value.length);
const categories=computed(()=>catalogKinds.filter(item=>item.id==='all'||rows.value.some(row=>catalogKind(row)===item.id)));
let revision=0;
onShow(initialize);
function count(kind:string){return kind==='all'?rows.value.length:rows.value.filter(row=>catalogKind(row)===kind).length;}
async function initialize(){
  const kind=mallStorage.get('saidian-catalog-kind');
  if(catalogKinds.some(item=>item.id===kind))selected.value=kind;
  mallStorage.remove('saidian-catalog-kind');
  await load();
  const legacy=mallStorage.get('saidian-category-selected');
  if(legacy!==undefined&&legacy!==null&&mallStorage.has('saidian-category-selected')){
    const matched=rows.value.find(row=>row.categoryId===legacy);selected.value=legacy && matched?catalogKind(matched):'all';
    mallStorage.remove('saidian-category-selected');
  }
}
async function load(force=false){const request=++revision;busy.value=true;error.value='';try{const result=await loadCatalog(force);if(request===revision)rows.value=result;}catch(cause){if(request===revision)error.value=cause instanceof Error?cause.message:'商品暂时无法加载';}finally{if(request===revision)busy.value=false;}}
function select(kind:CatalogKind){selected.value=kind;}
function retry(){return load(true);}
function search(){uni.navigateTo({url:'/pages/search/index'});}
function openProduct(id:string){uni.navigateTo({url:'/pages/product/index?id='+encodeURIComponent(id)});}
</script>
<style scoped lang="scss">
.catalog-heading{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:20px 0 24px}.eyebrow{font-size:10px;letter-spacing:2px;color:var(--green);font-weight:700}h1{font-size:30px;line-height:1.3;margin:10px 0 0;letter-spacing:-1px}.catalog-heading .text-button{display:flex;align-items:center;gap:6px;background:none;font-size:13px;flex:none}.category-nav{display:flex;gap:8px;overflow:auto;padding-bottom:8px}.category-item{display:flex;align-items:center;gap:6px;margin:0;flex:none;padding:10px 16px;min-height:44px;line-height:1.5;border:1px solid var(--line);border-radius:999px;background:white;color:var(--ink);font-size:14px}.category-item text{font-size:11px;opacity:.7}.category-item.active{background:var(--green);color:white;border-color:var(--green)}.category-item::after{border:0}.catalog-toolbar{display:flex;align-items:center;justify-content:space-between;margin:20px 0;color:var(--muted);font-size:13px}.sort-picker{display:flex;align-items:center;gap:8px;min-height:44px}.catalog-skeleton{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.skeleton-card{height:260px;background:#e8ece2;border-radius:18px}@media(min-width:900px){.product-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}h1{font-size:40px}.catalog-skeleton{grid-template-columns:repeat(3,1fr)}}@media(max-width:380px){h1{font-size:24px}.catalog-heading .text-button{font-size:12px}}
</style>
