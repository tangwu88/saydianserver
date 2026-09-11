<template><DesktopHeader/><view class="page"><view class="container checkout-layout"><view>
  <view class="section-title">确认订单</view><view v-if="error" class="error-state" role="alert">{{ error }}</view><view v-if="priceChanged && !error" class="error-state" role="status">部分商品价格已变化，以下为服务端最新价格，请核对后提交。</view>
  <button class="card address-card" :disabled="submitting" @click="chooseAddress"><template v-if="address"><b>{{ address.name }} {{ address.mobile }}</b><text>{{ address.province }}{{ address.city }}{{ address.district }}{{ address.detail }}</text><text class="link">更换地址 →</text></template><text v-else>＋ 添加收货地址</text></button>
  <view class="card block"><h2>商品清单</h2><view v-for="item in quote?.lines||[]" :key="item.skuId" class="goods-item"><image v-if="item.image" :src="item.image" mode="aspectFit"/><view><b>{{ item.name }}</b><text class="muted">{{ item.specification }}</text><text>{{ money(item.unitPriceCents) }} × {{ item.quantity }}</text></view></view><view v-if="!quote" class="empty">{{ quoting?'正在重新报价…':'请添加地址后获取最新报价' }}</view></view>
  <view class="card block"><h2>优惠与订单信息</h2><view class="field"><text class="field-label">优惠券</text><picker class="coupon-picker" :range="couponLabels" :disabled="submitting" @change="selectCoupon"><view>{{ selectedCoupon?.coupon?.name || "不使用优惠券" }} ›</view></picker></view><view class="field"><text>积分可抵扣金额</text><b>{{ quote?.availablePointCents == null ? "未获取" : money(quote.availablePointCents) }}</b></view>
  <view class="field"><text>使用积分金额</text><input v-model="pointAmount" class="money-input" type="digit" placeholder="0.00" :disabled="submitting||quote?.availablePointCents==null" @blur="refreshQuote"/><button class="text-button" :disabled="submitting" @click="maxPoints">用最多</button></view><text class="muted">积分不抵运费，现金至少保留 ¥0.01。</text>
  <button class="optional-toggle" :disabled="submitting" @click="showRemark=!showRemark">{{ showRemark ? '收起订单备注' : '添加订单备注（选填）' }} ›</button><label v-if="showRemark" class="form-label">订单备注<input v-model="remark" :disabled="submitting" class="input" maxlength="500" placeholder="如有配送要求，请在这里填写"/></label></view>
</view><view class="card settle"><h2>金额明细</h2><view class="money-line"><text>商品金额</text><b>{{ money(quote?.subtotalCents) }}</b></view><view class="money-line"><text>优惠券</text><b>−{{ money(quote?.couponDiscountCents) }}</b></view><view class="money-line"><text>积分抵扣</text><b>−{{ money(quote?.pointDiscountCents) }}</b></view><view class="money-line"><text>运费</text><b>{{ money(quote?.shippingCents) }}</b></view><view class="money-line total"><text>现金应付</text><b>{{ money(quote?.payableCents) }}</b></view>
<text v-if="capabilities?.maintenance?.readOnly" class="error-state">{{ capabilities.maintenance.reason || "商城维护中，暂不可下单" }}</text>
<text v-else-if="capabilities?.checkout?.enabled === false" class="error-state">{{ uncertain ? '当前暂停新下单，仍可查询上次下单结果。' : '当前收货地区暂不可下单，请稍后再试。' }}</text>
<text v-if="capabilities && !hasPayment" class="muted">{{ capabilities.demo?"本地测试：仅保存待付款订单，不会扣款。":"支付暂不可用，可先保存订单，稍后在订单详情中继续支付。" }}</text>
<button class="primary-btn" :loading="submitting||quoting" :disabled="submitting||quoting||(!uncertain && (!quote||!address||capabilities?.checkout?.enabled === false))||capabilities?.maintenance?.readOnly" @click="submit">{{ uncertain ? '查询并恢复上次下单' : quoteNeedsConfirmation ? '确认新金额并提交' : hasPayment ? '提交订单，前往支付' : '保存待付款订单' }}</button>
<button class="text-button" :disabled="submitting||quoting" @click="refreshQuote">重新获取报价</button>
</view></view></view></template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
import { onShow } from "@dcloudio/uni-app";import { computed,ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";import { api,money,requireLogin,toast,withMallCheckoutLock,mallSessionStamp } from "../../api";import { checkoutFingerprint,checkoutQuoteFingerprint,parseMoneyCents,channelsForEnvironment } from "../../commerce-model";
import { paymentEnvironment } from "../../payments";
const items=ref<any[]>([]),addresses=ref<any[]>([]),address=ref<any>(),coupons=ref<any[]>([]),selectedCoupon=ref<any>(),quote=ref<any>(),capabilities=ref<any>(),remark=ref(""),showRemark=ref(false),pointAmount=ref("0.00"),submitting=ref(false),quoting=ref(false),error=ref("");
let revision=0;
const uncertain=ref(false),quoteNeedsConfirmation=ref(false);
const priceChanged=computed(()=>quote.value?.lines?.some((line:any)=>{const cached=items.value.find(item=>item.skuId===line.skuId)?.sku?.salePriceCents;return cached!=null && cached!==line.unitPriceCents;}));
const availableCoupons=computed(()=>coupons.value.filter(x=>!x.usedAt));const couponLabels=computed(()=>["不使用优惠券",...availableCoupons.value.map(x=>x.coupon.name)]);const hasPayment=computed(()=>channelsForEnvironment(capabilities.value?.payments||[],paymentEnvironment(),uni.getSystemInfoSync().windowWidth>=900).some((x:any)=>x.enabled));
onShow(async()=>{if(!requireLogin("/pages/checkout/index"))return;error.value="";
  const user=mallStorage.get("saidian-user");const pending=mallStorage.get("checkout-pending");
  const draft=mallStorage.get('checkout-draft');uncertain.value=!!(draft?.uncertain && draft.userId===user?.id);
  if (mallStorage.get('checkout-owner') !== user?.id) { error.value='结算账号已改变，请重新选择商品'; return; }
  if(pending?.userId===user?.id && pending.orderId){uni.redirectTo({url:"/pages/order-detail/index?id="+pending.orderId});return;}
  items.value=mallStorage.get("checkout-items")||[];if(!items.value.length){error.value="结算商品为空，请从购物车或商品页选择";return;}
  try{const [rows,claims,caps]=await Promise.all([api<any[]>("/storefront/addresses",{auth:true}),api<any[]>("/storefront/coupons",{auth:true}),api("/storefront/capabilities")]);
    addresses.value=rows;coupons.value=claims;capabilities.value=caps;const chosen=mallStorage.get("checkout-address");address.value=rows.find(x=>x.id===chosen?.id)||rows.find(x=>x.id===address.value?.id)||rows.find(x=>x.isDefault)||rows[0];mallStorage.remove("checkout-address");await refreshQuote();
  }catch(e){error.value=e instanceof Error?e.message:"加载失败";}
});
function input(conditional=false){const expectedQuote=quote.value?.fingerprint;if(conditional && (typeof expectedQuote!=="string"||!/^q1:[a-f0-9]{64}$/.test(expectedQuote)))throw new Error('报价凭据尚未就绪，请重新获取报价');return {addressId:address.value?.id||"",items:items.value.map(x=>({skuId:x.skuId,quantity:Number(x.quantity)})),...(selectedCoupon.value?{couponClaimId:selectedCoupon.value.id}:{}),pointCents:parseMoneyCents(pointAmount.value||"0"),buyerRemark:remark.value,...(conditional?{expectedQuote}:{})};}
async function refreshQuote(){const request=++revision;quote.value=null;if(!address.value||!items.value.length)return;quoting.value=true;error.value="";try{const result:any=await api("/storefront/orders/preview",{method:"POST",auth:true,data:input()});if(request===revision){if(!result.quote)throw new Error("服务端报价尚未就绪");quote.value=result.quote;}}catch(e){if(request===revision)error.value=e instanceof Error?e.message:"报价失败";}finally{if(request===revision)quoting.value=false;}}
function selectCoupon(event:any){selectedCoupon.value=availableCoupons.value[Number(event.detail.value)-1];void refreshQuote();}
function maxPoints(){pointAmount.value=((quote.value?.maxPointCents||0)/100).toFixed(2);void refreshQuote();}
function chooseAddress(){uni.navigateTo({url:addresses.value.length?"/pages/addresses/index?select=1":"/pages/address-edit/index"});}
async function submit(){if(submitting.value||quoting.value||(!uncertain.value&&(!address.value||capabilities.value?.checkout?.enabled===false))||capabilities.value?.maintenance?.readOnly)return;submitting.value=true;error.value="";let submittedKey='',submittedUserId='',submittedSession='';
  try{await withMallCheckoutLock(async()=>{try{const checkoutSession=mallSessionStamp();const user=mallStorage.get('saidian-user');let draft=mallStorage.get('checkout-draft');
    if (!user?.id || mallStorage.get('checkout-owner')!==user.id) throw new Error('结算账号已改变，请重新选择商品');
    const completed=mallStorage.get('checkout-pending');if(completed?.userId===user.id && completed.orderId){uni.redirectTo({url:'/pages/order-detail/index?id='+encodeURIComponent(completed.orderId)});return;}
    if (draft?.userId && draft.userId!==user.id) throw new Error('结算账号已改变，请重新选择商品');
    if (capabilities.value?.maintenance?.readOnly) throw new Error('商城维护中，请稍后查询下单结果');
    if (capabilities.value?.checkout?.enabled===false && !(draft?.uncertain===true && draft.userId===user.id && typeof draft.key==='string' && draft.key.length>=8 && draft.payload && typeof draft.payload==='object')) throw new Error('当前暂停新下单，请从订单列表核对上次结果');
    if (!draft?.uncertain) { const displayedQuote=checkoutQuoteFingerprint(quote.value);await refreshQuote();
      if(mallSessionStamp()!==checkoutSession || mallStorage.get('saidian-user')?.id!==user.id || mallStorage.get('checkout-owner')!==user.id)throw new Error('账号已切换，请重新打开结算页');
      const recovered=mallStorage.get('checkout-pending');if(recovered?.userId===user.id && recovered.orderId){uni.redirectTo({url:'/pages/order-detail/index?id='+encodeURIComponent(recovered.orderId)});return;}
      // Another checkout may have submitted while this quote was in flight.
      // Re-read its frozen key/payload before constructing a new request.
      const latest=mallStorage.get('checkout-draft');
      if(latest?.userId && latest.userId!==user.id)throw new Error('结算账号已改变，请重新选择商品');
      if(latest?.uncertain)draft=latest;
      else {if(!quote.value)throw new Error(error.value||'请重新获取报价');
        if(displayedQuote!==checkoutQuoteFingerprint(quote.value)){quoteNeedsConfirmation.value=true;error.value='订单金额已更新，请核对商品、优惠、积分及运费后再次确认提交。';return;}
        quoteNeedsConfirmation.value=false;const payload=input(true);const fingerprint=checkoutFingerprint(user.id,payload);
        draft=latest?.fingerprint===fingerprint?latest:{fingerprint,key:'h5-order-'+Date.now()+'-'+Math.random().toString(36).slice(2),payload,userId:user.id};
      }
    }
    // An uncertain request may already have consumed stock/coupon/points. Recover
    // its exact payload and key before attempting any new quote or new order.
    if(mallSessionStamp()!==checkoutSession || mallStorage.get('saidian-user')?.id!==user.id || mallStorage.get('checkout-owner')!==user.id)throw new Error('账号已切换，请重新打开结算页');
    draft.uncertain=true;mallStorage.set("checkout-draft",draft);
    submittedKey=draft.key;submittedUserId=user.id;submittedSession=checkoutSession;
    const order:any=await api("/storefront/orders",{method:"POST",auth:true,headers:{"idempotency-key":draft.key},data:draft.payload,sessionStamp:checkoutSession});
    if(mallSessionStamp()!==checkoutSession || mallStorage.get('saidian-user')?.id!==user.id || mallStorage.get('checkout-owner')!==user.id)throw new Error('账号已切换，请从原账号订单页核对下单结果');
    mallStorage.set("checkout-pending",{userId:user.id,orderId:order.id});mallStorage.remove("checkout-draft");mallStorage.remove("checkout-items");
    uni.redirectTo({url:"/pages/order-detail/index?id="+order.id});
  }catch(e){const status=(e as any)?.status;if(submittedKey && mallSessionStamp()===submittedSession && [400,409,422].includes(status) && mallStorage.get('saidian-user')?.id===submittedUserId && mallStorage.get('checkout-owner')===submittedUserId){const draft=mallStorage.get("checkout-draft");if(draft?.key===submittedKey && draft.userId===submittedUserId){draft.uncertain=false;mallStorage.set("checkout-draft",draft);}}uncertain.value=!!mallStorage.get('checkout-draft')?.uncertain;
    throw e;
  }});}catch(e){error.value=e instanceof Error?e.message:"下单结果待确认，请使用相同内容重试";toast(e);
  }finally{submitting.value=false;}
}
</script>
<style scoped>.field-label{flex:none;white-space:nowrap}.coupon-picker{min-width:0;flex:1;text-align:right;overflow-wrap:anywhere;line-height:1.6;padding:12px 0}.optional-toggle{width:100%;margin:8px 0 0;padding:10px 0;min-height:44px;text-align:left;background:transparent;color:var(--green);font-size:14px;line-height:1.5}.optional-toggle::after{border:0}</style>
<style scoped>.checkout-layout{display:grid;gap:24px;}.checkout-layout>view{min-width:0;}h2{font-size:18px;margin:0 0 20px;}.address-card{text-align:left;line-height:1.6;width:100%;display:block;color:var(--ink);font-size:16px;}.address-card text{display:block;margin-top:8px;}.link{color:var(--green);}.block{margin-top:18px;}.goods-item{display:flex;gap:16px;padding:16px 0;border-top:1px solid var(--line);}.goods-item image{width:82px;height:82px;flex:none;}.goods-item text{display:block;margin-top:8px;}.field{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:54px;border-top:1px solid var(--line);font-size:14px;}.money-input{text-align:right;width:90px;min-height:44px;}.form-label{display:block;font-size:14px;margin:18px 0;}.input{margin-top:8px;}.money-line{display:flex;justify-content:space-between;margin-bottom:18px;}.total{border-top:1px solid var(--line);padding-top:18px;font-weight:700;}.total b{color:#be092d;font-size:24px;}.muted{display:block;font-size:14px;line-height:1.6;}.settle .primary-btn{margin-top:24px;}.text-button{margin:12px 0;}@media(min-width:900px){.checkout-layout{grid-template-columns:minmax(0,1fr) 360px;align-items:start;}.settle{position:sticky;top:100px;}}</style>
