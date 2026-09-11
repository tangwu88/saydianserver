<template>
  <DesktopHeader /><view class="page"><view class="container coupon-page">
    <view class="section-title">优惠券</view>
    <view class="tabs" aria-label="优惠券分类"><button v-for="tab in tabs" :key="tab.value" :class="{active:mode===tab.value}" @click="select(tab.value)">{{ tab.label }}</button></view>
    <view v-if="error" class="error-state" role="alert">{{ error }}<button class="text-button" :disabled="busy" @click="load(failedMore)">重试</button></view>
    <view v-if="busy && !rows.length" class="empty">正在加载…</view>
    <view v-for="row in visibleRows" :key="row.id" :class="['coupon',mode!=='available' && state(row)!=='可使用' && 'inactive']">
      <view class="coupon-value"><b>{{ money(coupon(row).value) }}</b><text>满 {{ money(coupon(row).minimumSpendCents) }} 可用</text></view>
      <view class="coupon-info"><b>{{ coupon(row).name }}</b><text>{{ date(coupon(row).validFrom) }} 至 {{ date(coupon(row).validUntil) }}</text>
        <button v-if="mode==='available'" class="outline-btn" :disabled="!!claiming || row.claimed || !row.available" @click="claim(row)">{{ row.claimed ? '已领取' : !row.available ? '已领完' : claiming===row.id ? '领取中…' : '领取' }}</button>
        <button v-else-if="state(row)==='可使用'" class="outline-btn" @click="shop">去使用</button><text v-else class="status">{{ state(row) }}</text>
      </view>
    </view>
    <view v-if="!busy && !error && !visibleRows.length" class="empty card">{{ mode==='available' ? '暂无可领取的优惠券' : '暂无此类优惠券' }}</view>
    <button v-if="mode==='available' && hasMore" class="outline-btn" :disabled="busy" @click="load(true)">加载更多</button>
  </view></view>
</template>
<script setup lang="ts">
import { onShow, onHide } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import DesktopHeader from '../../components/DesktopHeader.vue';
import { api, money, toast, mallSessionStamp } from '../../api';
const tabs=[{value:'usable',label:'可使用'},{value:'used',label:'已使用'},{value:'expired',label:'已失效'},{value:'available',label:'领券中心'}];
const mode=ref('usable'),rows=ref<any[]>([]),busy=ref(false),error=ref(''),claiming=ref(''),hasMore=ref(false),failedMore=ref(false);
let generation=0,page=1;
const coupon=(row:any)=>row.coupon||row;
function state(row:any){const c=coupon(row),now=Date.now();return row.usedAt?'已使用':c.status!=='ACTIVE'?'已停用':new Date(c.validUntil).getTime()<now?'已过期':new Date(c.validFrom).getTime()>now?'未到使用时间':'可使用';}
const visibleRows=computed(()=>mode.value==='available'?rows.value:rows.value.filter(row=>mode.value==='usable'?['可使用','未到使用时间'].includes(state(row)):mode.value==='used'?state(row)==='已使用':['已停用','已过期'].includes(state(row))));
onShow(()=>load());onHide(()=>{generation++;busy.value=false;claiming.value='';rows.value=[];});
function select(value:string){mode.value=value;void load();}
async function load(more=false){
  if(more&&busy.value)return;const current=++generation,session=mallSessionStamp(),tab=mode.value,next=more?page+1:1;
  busy.value=true;error.value='';failedMore.value=more;if(!more){rows.value=[];hasMore.value=false;claiming.value='';page=1;}
  const valid=()=>current===generation&&session===mallSessionStamp();
  try{const result:any=await api(tab==='available'?'/storefront/coupons/available?page='+next:'/storefront/coupons',{auth:true,sessionStamp:session});
    if(!valid())return;const list=tab==='available'?result.items:result;if(!Array.isArray(list))throw new Error('优惠券暂时无法加载');
    rows.value=more?[...rows.value,...list]:list;hasMore.value=!!result.pagination?.hasMore;page=next;
  }catch(e){if(valid())error.value=e instanceof Error?e.message:'优惠券加载失败';}finally{if(valid())busy.value=false;}
}
async function claim(row:any){
  if(claiming.value||row.claimed||!row.available)return;const current=generation,session=mallSessionStamp();claiming.value=row.id;
  try{await api('/storefront/coupons/'+encodeURIComponent(row.id)+'/claim',{method:'POST',auth:true,sessionStamp:session});
    if(current!==generation||session!==mallSessionStamp())return;row.claimed=true;toast('领取成功，可在结算时使用');
  }catch(e){if(current===generation&&session===mallSessionStamp()){toast(e);await load();}}
  finally{if(current===generation&&session===mallSessionStamp())claiming.value='';}
}
function date(value:string){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleDateString('zh-CN'):'日期待更新';}
function shop(){uni.switchTab({url:'/pages/category/index'});}
</script>
<style scoped>
.coupon-page{max-width:850px}.tabs{display:flex;gap:8px;overflow-x:auto;margin-bottom:20px}.tabs button{flex:1;min-width:70px;padding:10px 5px;min-height:44px;margin:0;font-size:14px;line-height:1.5;background:white;color:var(--muted)}.tabs .active{background:#005bad;color:white}.coupon{display:grid;grid-template-columns:120px minmax(0,1fr);background:white;border-radius:14px;overflow:hidden;margin:16px 0}.coupon-value{padding:24px 10px;background:#005bad;color:white;text-align:center;display:flex;flex-direction:column;justify-content:center;gap:10px}.coupon-value b{font-size:25px;overflow-wrap:anywhere}.coupon-value text{font-size:12px;line-height:1.5}.coupon-info{padding:18px;min-width:0;overflow-wrap:anywhere}.coupon-info>text{display:block;font-size:12px;color:var(--muted);line-height:1.8;margin-top:10px}.coupon-info button{font-size:14px;min-height:44px;padding:8px 20px;margin:14px 0 0;width:100%;line-height:1.5}.inactive .coupon-value{background:#6b7280}.error-state{padding:14px;color:#a8322a;background:#fff1ef;border-radius:10px}.error-state button{min-height:44px}@media(max-width:350px){.coupon{grid-template-columns:100px minmax(0,1fr)}.coupon-info{padding:14px}.coupon-value b{font-size:22px}}
</style>
