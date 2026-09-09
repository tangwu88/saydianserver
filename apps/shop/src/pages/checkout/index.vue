<template><DesktopHeader/><view class="page"><view class="container checkout-layout"><view>
  <view class="section-title">确认订单</view><view v-if="error" class="error-state">{{ error }}</view><view v-if="priceChanged" class="error-state">部分商品价格已变化，以下为服务端最新价格，请核对后提交。</view>
  <button class="card address-card" @click="chooseAddress"><template v-if="address"><b>{{ address.name }} {{ address.mobile }}</b><text>{{ address.province }}{{ address.city }}{{ address.district }}{{ address.detail }}</text><text class="link">更换地址 →</text></template><text v-else>＋ 添加收货地址</text></button>
  <view class="card block"><h2>商品清单</h2><view v-for="item in quote?.lines||[]" :key="item.skuId" class="goods-item"><image v-if="item.image" :src="item.image" mode="aspectFit"/><view><b>{{ item.name }}</b><text class="muted">{{ item.specification }}</text><text>{{ money(item.unitPriceCents) }} × {{ item.quantity }}</text></view></view><view v-if="!quote" class="empty">{{ quoting?'正在重新报价…':'请添加地址后获取最新报价' }}</view></view>
  <view class="card block"><h2>优惠与订单信息</h2><view class="field"><text>优惠券</text><picker :range="couponLabels" @change="selectCoupon"><view>{{ selectedCoupon?.coupon?.name || "不使用优惠券" }} ›</view></picker></view><view class="field"><text>积分可抵扣金额</text><b>{{ quote?.availablePointCents == null ? "未获取" : money(quote.availablePointCents) }}</b></view>
  <view class="field"><text>使用积分金额</text><input v-model="pointAmount" class="money-input" type="digit" placeholder="0.00" :disabled="quote?.availablePointCents==null" @blur="refreshQuote"/><button class="text-button" @click="maxPoints">用最多</button></view><text class="muted">积分不抵运费，现金至少保留 ¥0.01。</text>
  <label class="form-label">买家留言<input v-model="remark" class="input" maxlength="500" placeholder="选填，可填写配送要求"/></label><label class="form-label">发票抬头<input v-model="invoiceTitle" class="input" maxlength="200" placeholder="选填，开票以后台政策为准"/></label></view>
</view><view class="card settle"><h2>金额明细</h2><view class="money-line"><text>商品金额</text><b>{{ money(quote?.subtotalCents) }}</b></view><view class="money-line"><text>优惠券</text><b>−{{ money(quote?.couponDiscountCents) }}</b></view><view class="money-line"><text>积分抵扣</text><b>−{{ money(quote?.pointDiscountCents) }}</b></view><view class="money-line"><text>运费</text><b>{{ money(quote?.shippingCents) }}</b></view><view class="money-line total"><text>现金应付</text><b>{{ money(quote?.payableCents) }}</b></view>
<text v-if="capabilities?.maintenance?.readOnly" class="error-state">{{ capabilities.maintenance.reason || "商城维护中，暂不可下单" }}</text>
<text v-if="capabilities && !hasPayment" class="muted">支付渠道未配置。{{ capabilities.demo?"可创建演示待付款订单，不会扣款。":"订单可保存为待付款，暂不能支付。" }}</text>
<button class="primary-btn" :loading="submitting||quoting" :disabled="submitting||quoting||(!uncertain && (!quote||!address))||capabilities?.maintenance?.readOnly" @click="submit">{{ uncertain ? '查询并恢复上次下单' : '提交订单，前往支付' }}</button>
<button class="text-button" :disabled="quoting" @click="refreshQuote">重新获取报价</button>
</view></view></view></template>
<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";import { computed,ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";import { api,money,requireLogin,toast,withMallCheckoutLock,mallSessionStamp } from "../../api";import { checkoutFingerprint,parseMoneyCents } from "../../commerce-model";
const items=ref<any[]>([]),addresses=ref<any[]>([]),address=ref<any>(),coupons=ref<any[]>([]),selectedCoupon=ref<any>(),quote=ref<any>(),capabilities=ref<any>(),remark=ref(""),invoiceTitle=ref(""),pointAmount=ref("0.00"),submitting=ref(false),quoting=ref(false),error=ref("");
let revision=0;
const uncertain=ref(false);
const priceChanged=computed(()=>quote.value?.lines?.some((line:any)=>{const cached=items.value.find(item=>item.skuId===line.skuId)?.sku?.salePriceCents;return cached!=null && cached!==line.unitPriceCents;}));
const availableCoupons=computed(()=>coupons.value.filter(x=>!x.usedAt));const couponLabels=computed(()=>["不使用优惠券",...availableCoupons.value.map(x=>x.coupon.name)]);const hasPayment=computed(()=>capabilities.value?.payments?.some((x:any)=>x.enabled));
onShow(async()=>{if(!requireLogin("/pages/checkout/index"))return;error.value="";
  const user=uni.getStorageSync("saidian-user");const pending=uni.getStorageSync("checkout-pending");
  const draft=uni.getStorageSync('checkout-draft');uncertain.value=!!(draft?.uncertain && draft.userId===user?.id);
  if (uni.getStorageSync('checkout-owner') !== user?.id) { error.value='结算账号已改变，请重新选择商品'; return; }
  if(pending?.userId===user?.id && pending.orderId){uni.redirectTo({url:"/pages/order-detail/index?id="+pending.orderId});return;}
  items.value=uni.getStorageSync("checkout-items")||[];if(!items.value.length){error.value="结算商品为空，请从购物车或商品页选择";return;}
  try{const [rows,claims,caps]=await Promise.all([api<any[]>("/storefront/addresses",{auth:true}),api<any[]>("/storefront/coupons",{auth:true}),api("/storefront/capabilities")]);
    addresses.value=rows;coupons.value=claims;capabilities.value=caps;const chosen=uni.getStorageSync("checkout-address");address.value=rows.find(x=>x.id===chosen?.id)||rows.find(x=>x.id===address.value?.id)||rows.find(x=>x.isDefault)||rows[0];uni.removeStorageSync("checkout-address");await refreshQuote();
  }catch(e){error.value=e instanceof Error?e.message:"加载失败";}
});
function input(){return {addressId:address.value?.id||"",items:items.value.map(x=>({skuId:x.skuId,quantity:Number(x.quantity)})),...(selectedCoupon.value?{couponClaimId:selectedCoupon.value.id}:{}),pointCents:parseMoneyCents(pointAmount.value||"0"),buyerRemark:remark.value,...(invoiceTitle.value?{invoice:{title:invoiceTitle.value}}:{})};}
async function refreshQuote(){const request=++revision;quote.value=null;if(!address.value||!items.value.length)return;quoting.value=true;error.value="";try{const result:any=await api("/storefront/orders/preview",{method:"POST",auth:true,data:input()});if(request===revision){if(!result.quote)throw new Error("服务端报价尚未就绪");quote.value=result.quote;}}catch(e){if(request===revision)error.value=e instanceof Error?e.message:"报价失败";}finally{if(request===revision)quoting.value=false;}}
function selectCoupon(event:any){selectedCoupon.value=availableCoupons.value[Number(event.detail.value)-1];void refreshQuote();}
function maxPoints(){pointAmount.value=((quote.value?.maxPointCents||0)/100).toFixed(2);void refreshQuote();}
function chooseAddress(){uni.navigateTo({url:addresses.value.length?"/pages/addresses/index?select=1":"/pages/address-edit/index"});}
async function submit(){if(submitting.value||quoting.value||(!uncertain.value&&!address.value))return;submitting.value=true;error.value="";let submittedKey='',submittedUserId='',submittedSession='';
  try{await withMallCheckoutLock(async()=>{try{const checkoutSession=mallSessionStamp();const user=uni.getStorageSync('saidian-user');let draft=uni.getStorageSync('checkout-draft');
    if (!user?.id || uni.getStorageSync('checkout-owner')!==user.id) throw new Error('结算账号已改变，请重新选择商品');
    const completed=uni.getStorageSync('checkout-pending');if(completed?.userId===user.id && completed.orderId){uni.redirectTo({url:'/pages/order-detail/index?id='+encodeURIComponent(completed.orderId)});return;}
    if (draft?.userId && draft.userId!==user.id) throw new Error('结算账号已改变，请重新选择商品');
    if (!draft?.uncertain) { await refreshQuote();
      if(mallSessionStamp()!==checkoutSession || uni.getStorageSync('saidian-user')?.id!==user.id || uni.getStorageSync('checkout-owner')!==user.id)throw new Error('账号已切换，请重新打开结算页');
      const recovered=uni.getStorageSync('checkout-pending');if(recovered?.userId===user.id && recovered.orderId){uni.redirectTo({url:'/pages/order-detail/index?id='+encodeURIComponent(recovered.orderId)});return;}
      // Another checkout may have submitted while this quote was in flight.
      // Re-read its frozen key/payload before constructing a new request.
      const latest=uni.getStorageSync('checkout-draft');
      if(latest?.userId && latest.userId!==user.id)throw new Error('结算账号已改变，请重新选择商品');
      if(latest?.uncertain)draft=latest;
      else {if(!quote.value)throw new Error(error.value||'请重新获取报价');const payload=input();const fingerprint=checkoutFingerprint(user.id,payload);
        draft=latest?.fingerprint===fingerprint?latest:{fingerprint,key:'h5-order-'+Date.now()+'-'+Math.random().toString(36).slice(2),payload,userId:user.id};
      }
    }
    // An uncertain request may already have consumed stock/coupon/points. Recover
    // its exact payload and key before attempting any new quote or new order.
    if(mallSessionStamp()!==checkoutSession || uni.getStorageSync('saidian-user')?.id!==user.id || uni.getStorageSync('checkout-owner')!==user.id)throw new Error('账号已切换，请重新打开结算页');
    draft.uncertain=true;uni.setStorageSync("checkout-draft",draft);
    submittedKey=draft.key;submittedUserId=user.id;submittedSession=checkoutSession;
    const order:any=await api("/storefront/orders",{method:"POST",auth:true,headers:{"idempotency-key":draft.key},data:draft.payload,sessionStamp:checkoutSession});
    if(mallSessionStamp()!==checkoutSession || uni.getStorageSync('saidian-user')?.id!==user.id || uni.getStorageSync('checkout-owner')!==user.id)throw new Error('账号已切换，请从原账号订单页核对下单结果');
    uni.setStorageSync("checkout-pending",{userId:user.id,orderId:order.id});uni.removeStorageSync("checkout-draft");uni.removeStorageSync("checkout-items");
    uni.redirectTo({url:"/pages/order-detail/index?id="+order.id});
  }catch(e){const status=(e as any)?.status;if(submittedKey && mallSessionStamp()===submittedSession && [400,409,422].includes(status) && uni.getStorageSync('saidian-user')?.id===submittedUserId && uni.getStorageSync('checkout-owner')===submittedUserId){const draft=uni.getStorageSync("checkout-draft");if(draft?.key===submittedKey && draft.userId===submittedUserId){draft.uncertain=false;uni.setStorageSync("checkout-draft",draft);}}uncertain.value=!!uni.getStorageSync('checkout-draft')?.uncertain;
    throw e;
  }});}catch(e){error.value=e instanceof Error?e.message:"下单结果待确认，请使用相同内容重试";toast(e);
  }finally{submitting.value=false;}
}
</script>
<style scoped>.checkout-layout{display:grid;gap:24px;}.checkout-layout>view{min-width:0;}h2{font-size:18px;margin:0 0 20px;}.address-card{text-align:left;line-height:1.6;width:100%;display:block;color:var(--ink);font-size:16px;}.address-card text{display:block;margin-top:8px;}.link{color:var(--green);}.block{margin-top:18px;}.goods-item{display:flex;gap:16px;padding:16px 0;border-top:1px solid var(--line);}.goods-item image{width:82px;height:82px;flex:none;}.goods-item text{display:block;margin-top:8px;}.field{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:54px;border-top:1px solid var(--line);font-size:14px;}.money-input{text-align:right;width:90px;min-height:44px;}.form-label{display:block;font-size:14px;margin:18px 0;}.input{margin-top:8px;}.money-line{display:flex;justify-content:space-between;margin-bottom:18px;}.total{border-top:1px solid var(--line);padding-top:18px;font-weight:700;}.total b{color:#be092d;font-size:24px;}.muted{display:block;font-size:14px;line-height:1.6;}.settle .primary-btn{margin-top:24px;}.text-button{margin:12px 0;}@media(min-width:900px){.checkout-layout{grid-template-columns:minmax(0,1fr) 360px;align-items:start;}.settle{position:sticky;top:100px;}}</style>
