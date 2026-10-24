<template>
  <DesktopHeader/><view class="page"><view class="container">
    <view class="searchbar"><UniIcons type="search" size="21"/><input v-model="keyword" confirm-type="search" placeholder="搜索商品名称、型号" aria-label="搜索商品名称、型号" @confirm="search()"/><button :disabled="busy" @click="search()">搜索</button></view>
    <view class="search-tools"><scroll-view scroll-x class="sorts"><button v-for="item in sorts" :key="item.id" :class="sort===item.id && 'active'" @click="setSort(item.id)">{{ item.name }}</button></scroll-view><text v-if="searched">{{ total }} 件商品</text></view>
    <view class="price-filter"><text>价格区间</text><input v-model="minimum" type="digit" placeholder="最低价" aria-label="最低价格（元）"/><text>—</text><input v-model="maximum" type="digit" placeholder="最高价" aria-label="最高价格（元）"/><button @click="applyPrice">确定</button><button v-if="minimum || maximum" @click="resetPrice">清除</button></view>
    <view v-if="error" class="error-state" role="alert">{{ error }}<button class="text-button" :disabled="busy" @click="retry">重新搜索</button></view>
    <view v-if="products.length" class="product-grid"><ProductCard v-for="(product,index) in products" :key="product.id" :product="product" :priority="index<2" @open="open"/></view>
    <view v-else-if="!error" class="empty"><text>{{ busy?'正在搜索…':searched?'没有找到相关商品，试试其他关键词':'请输入商品名称或型号' }}</text><view v-if="!searched" class="search-suggestions"><button v-for="word in ['W9S','W9','W8','戒指','表带']" :key="word" @click="suggest(word)">{{ word }}</button></view></view>
  </view></view>
</template>
<script setup lang="ts">
import { computed,ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import UniIcons from '@dcloudio/uni-ui/lib/uni-icons/uni-icons.vue';
import DesktopHeader from '../../components/DesktopHeader.vue';
import ProductCard from '../../components/ProductCard.vue';
import { loadCatalog } from '../../catalog-cache';
import { filterCatalog } from '../../catalog-presentation';
import { parseMoneyCents } from '../../commerce-model';
const busy=ref(false),searched=ref(false),error=ref(''),keyword=ref(''),sort=ref(''),rows=ref<any[]>([]),submitted=ref('');
const minimum=ref(''),maximum=ref(''),bounds=ref<{min:number;max:number}>({min:0,max:Infinity});
const sorts=[{id:'',name:'综合'},{id:'price_asc',name:'价格升序'},{id:'price_desc',name:'价格降序'},{id:'sales',name:'销量'}];
const products=computed(()=>filterCatalog(rows.value,'all',submitted.value,sort.value).filter(row=>Number.isSafeInteger(row.priceCents)&&row.priceCents>=bounds.value.min&&row.priceCents<=bounds.value.max));
const total=computed(()=>products.value.length);let revision=0;
onLoad(options=>{if(options?.keyword){keyword.value=String(options.keyword);void search();}});
async function search(force=false){const request=++revision;submitted.value=keyword.value.trim();searched.value=true;error.value='';busy.value=true;try{const result=await loadCatalog(force);if(request===revision)rows.value=result;}catch(cause){if(request===revision)error.value=cause instanceof Error?cause.message:'搜索暂时不可用';}finally{if(request===revision)busy.value=false;}}
function setSort(value:string){sort.value=value;if(!searched.value)void search();}
function applyPrice(){try{const min=minimum.value?parseMoneyCents(minimum.value):0,max=maximum.value?parseMoneyCents(maximum.value):Infinity;if(min>max)throw new Error('最高价不能低于最低价');bounds.value={min,max};error.value='';if(!searched.value)void search();}catch(cause){error.value=cause instanceof Error?cause.message:'请检查价格区间';}}
function resetPrice(){minimum.value='';maximum.value='';bounds.value={min:0,max:Infinity};error.value='';}
function retry(){return search(true);}
function suggest(word:string){keyword.value=word;void search();}
function open(id:string){uni.navigateTo({url:'/pages/product/index?id='+encodeURIComponent(id)});}
</script>
<style scoped>
.searchbar{display:flex;align-items:center;gap:10px;min-height:52px;padding-left:16px;background:white;border:1px solid var(--line);border-radius:999px;overflow:hidden}.searchbar input{flex:1;min-width:0;font-size:15px}.searchbar button{margin:0;padding:14px 21px;background:var(--green);color:white;font-size:14px;line-height:1.5;border-radius:999px}.search-tools{display:flex;align-items:center;gap:10px;margin:20px 0 10px;font-size:12px;color:var(--muted)}.sorts{min-width:0;flex:1;white-space:nowrap}.sorts button{display:inline-flex;min-height:44px;margin:0 8px 0 0;padding:10px 12px;background:transparent;color:var(--muted);line-height:1.4;font-size:13px;border-radius:999px}.sorts button::after{border:0}.sorts button.active{color:var(--green);background:var(--mint);font-weight:700}.price-filter{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0 0 22px;font-size:12px;color:var(--muted)}.price-filter input{width:77px;min-height:38px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:13px}.price-filter button{margin:0;background:white;color:var(--green);padding:7px 10px;min-height:38px;line-height:1.5;font-size:12px}.search-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:20px}.search-suggestions button{margin:0;border-radius:999px;background:var(--mint);color:var(--green);font-size:14px;padding:10px 20px;line-height:1.5}@media(min-width:900px){.product-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.searchbar{max-width:720px;margin:20px auto 30px}}
</style>
