<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view class="section-title">我的收藏</view
      ><view v-if="error" class="error-state" role="alert">{{ error }}<button class="text-button" :disabled="busy" @click="load">重试</button></view>
      <view v-if="products.length" class="product-grid"
        ><view v-for="product in products" :key="product.id"><ProductCard
          :product="product"
          @open="open" /><button class="text-button" :disabled="!!removing" @click="remove(product.id)">{{ removing===product.id ? '移除中…' : '取消收藏' }}</button></view></view
      ><view v-else-if="busy" class="empty">正在加载…</view><view v-else-if="!error" class="empty card">暂未收藏商品<button class="text-button" @click="shop">去逛逛</button></view></view
    ></view
  >
</template>
<script setup lang="ts">
import { onShow, onHide } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import ProductCard from "../../components/ProductCard.vue";
import { api, toast, mallSessionStamp } from "../../api";
const products = ref<any[]>([]),busy=ref(false),error=ref(''),removing=ref('');let generation=0;
onShow(load);onHide(()=>{generation++;products.value=[];busy.value=false;removing.value='';});
async function load() {
  const current=++generation,session=mallSessionStamp();busy.value=true;error.value='';
  products.value=[];
  try {
    const result=await api("/storefront/favorites", { auth: true,sessionStamp:session });
    if(current===generation&&session===mallSessionStamp())products.value=result;
  } catch (e) {
    if(current===generation&&session===mallSessionStamp())error.value=e instanceof Error?e.message:'收藏加载失败';
  }finally{if(current===generation&&session===mallSessionStamp())busy.value=false;}
}
async function remove(id:string){if(removing.value)return;const current=generation,session=mallSessionStamp();removing.value=id;try{await api('/storefront/favorites/'+encodeURIComponent(id),{method:'POST',auth:true,sessionStamp:session,data:{enabled:false}});if(current===generation&&session===mallSessionStamp())products.value=products.value.filter(p=>p.id!==id);}catch(e){if(current===generation&&session===mallSessionStamp())toast(e);}finally{if(current===generation&&session===mallSessionStamp())removing.value='';}}
function shop(){uni.switchTab({url:'/pages/category/index'});}
function open(id: string) {
  uni.navigateTo({ url: `/pages/product/index?id=${id}` });
}
</script>
<style scoped>.text-button{min-height:44px}.error-state{padding:16px;background:#fff1ef;color:#a8322a;border-radius:12px;margin-bottom:16px}</style>
