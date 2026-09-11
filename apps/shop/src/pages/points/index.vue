<template><DesktopHeader/><view class="page"><view class="container points">
  <view v-if="error" class="error-state" role="alert">{{ error }}<button class="text-button" :disabled="busy" @click="load(failedMore)">重试</button></view>
  <view class="card"><h2>我的积分</h2><text class="muted">可抵扣商品金额</text><view class="balance">{{ data?.verified ? money(data.balanceCents) : busy ? '加载中…' : '暂未获取' }}</view><text class="muted">{{ data?.verified ? '结算时可使用，不抵扣运费。退款成功后，按实际使用金额返还。' : '积分余额确认后即可使用。' }}</text><button v-if="data?.verified" class="text-button" @click="shop">去选购商品</button></view>
  <view class="card"><h3>积分明细</h3><button v-for="item in items" :key="item.id" class="ledger" :disabled="!item.orderId" @click="openOrder(item.orderId)"><view><b>{{ labels[item.type] || '积分变动' }}</b><text>{{ date(item.createdAt) }}</text></view><b>{{ item.deltaCents>=0?'+':'−' }}{{ money(Math.abs(item.deltaCents)) }}</b></button><view v-if="!items.length && !busy && !error" class="empty">暂无积分明细</view><button v-if="data?.pagination?.hasMore" class="outline-btn" :disabled="busy" @click="load(true)">加载更多</button></view>
</view></view></template>
<script setup lang="ts">
import {onShow,onHide} from '@dcloudio/uni-app';import{ref}from'vue';import DesktopHeader from '../../components/DesktopHeader.vue';import{api,money,mallSessionStamp}from'../../api';
const data=ref<any>(),items=ref<any[]>([]),error=ref(''),busy=ref(false),failedMore=ref(false);let page=1,generation=0;
const labels:Record<string,string>={ORDER_DEDUCT:'订单抵扣',ORDER_REDEMPTION:'订单抵扣',ORDER_CANCEL_RETURN:'取消订单返还',AFTER_SALE_RETURN:'售后返还',FULL_REFUND_RETURN:'退款返还',DEMO_TEST_CREDIT:'测试积分到账'};
onShow(()=>load());onHide(()=>{generation++;data.value=undefined;items.value=[];busy.value=false;});
async function load(more=false){if(more&&busy.value)return;const current=++generation,session=mallSessionStamp();busy.value=true;error.value='';failedMore.value=more;const next=more?page+1:1;if(!more){data.value=undefined;items.value=[];page=1;}
  const valid=()=>current===generation&&session===mallSessionStamp();
  try{const result:any=await api('/storefront/points?page='+next,{auth:true,sessionStamp:session});if(!valid())return;if(!Array.isArray(result.items))throw new Error('积分明细暂时无法加载');data.value=result;items.value=more?[...items.value,...result.items]:result.items;page=next;}catch(e){if(valid())error.value=e instanceof Error?e.message:'积分加载失败';}finally{if(valid())busy.value=false;}}
function openOrder(id?:string){if(id)uni.navigateTo({url:'/pages/order-detail/index?id='+encodeURIComponent(id)});}
function shop(){uni.switchTab({url:'/pages/category/index'});}
function date(value:string){return new Date(value).toLocaleString('zh-CN',{hour12:false});}
</script>
<style scoped>.points{max-width:850px;display:grid;gap:20px}.card h2,.card h3{margin:0 0 18px}.balance{font-size:36px;color:#be092d;margin:20px 0}.muted{font-size:14px;line-height:1.7}.ledger{display:flex;width:100%;justify-content:space-between;gap:16px;padding:18px 0;margin:0;border-top:1px solid var(--line);border-radius:0;font-size:15px;text-align:left;line-height:1.5;background:transparent;color:var(--ink);min-height:64px}.ledger view{min-width:0;overflow-wrap:anywhere}.ledger>b{flex:none}.ledger text{display:block;color:var(--muted);font-size:13px;margin-top:8px}.ledger[disabled]{color:var(--ink);background:transparent;opacity:1}.error-state{padding:14px;color:#a8322a;background:#fff1ef;border-radius:10px}.text-button{min-height:44px}</style>
