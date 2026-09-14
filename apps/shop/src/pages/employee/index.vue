<template>
  <DesktopHeader />
  <view :class="['page', memberMode && 'saydian-app-surface promotion-surface']">
    <view :class="['container', memberMode && 'promotion-content']">
      <view class="page-heading">
        <h1 class="page-title">{{ memberMode ? '我的推广' : '员工推广中心' }}</h1>
        <button v-if="memberMode" class="text-button profile-link" @click="backToProfile">会员中心 ›</button>
      </view>
      <view v-if="!authorized" class="card employee-login">
        <view class="logo">{{ memberMode ? '奖' : '企' }}</view>
        <text>{{ memberMode ? '会员推广与奖金' : '赛电商城推广中心' }}</text>
        <text class="small">{{ loginMessage }}</text>
        <button v-if="memberMode" class="primary-btn" @click="openLogin">登录会员账号</button>
        <view v-if="!memberMode && demo" class="demo-login"><text class="small">隔离演示：使用本机私有运行目录的员工测试会话，不连接企业微信。</text><input v-model="demoToken" password class="input" placeholder="粘贴本地员工测试会话"/><button class="primary-btn" @click="useDemoSession">进入测试工作台</button></view>
      </view>
      <template v-else-if="data">
        <view class="card filters">
          <picker :range="ranges.map(x=>x.label)" :value="rangeIndex" @change="changeRange"><view class="range-picker"><text class="small">统计范围</text><b>{{ ranges[rangeIndex]?.label }}</b><text class="chevron">›</text></view></picker>
          <template v-if="ranges[rangeIndex]?.key==='custom'"><picker mode="date" :value="from" @change="from=String($event.detail.value)"><view>开始：{{ from || '选择日期' }}</view></picker><picker mode="date" :value="to" @change="to=String($event.detail.value)"><view>结束：{{ to || '选择日期' }}</view></picker><button size="mini" @click="page=1;load()">查询</button></template>
          <button v-if="!memberMode" size="mini" @click="logout">退出员工账号</button>
        </view>
        <view :class="['employee-head', 'card', memberMode && 'member-promotion-hero']">
          <view class="promotion-summary">
            <view v-if="memberMode" class="promotion-avatar" aria-hidden="true">{{ String(data.employee.name || 'S').slice(0, 1) }}</view>
            <view class="promotion-copy">
              <text class="small">{{ memberMode ? '推广身份' : '所选期间净销售额' }}</text>
              <text v-if="!memberMode" class="legacy-amount">{{ money(data.netSalesCents) }}</text>
              <b>{{ data.employee.name }}</b>
              <text class="referral-code">推广码 {{ data.employee.referralCode }}</text>
            </view>
          </view>
          <view v-if="memberMode && data.promotion" class="hero-actions"><button class="outline-btn" @click="copy(data.promotion.linkUrl)">复制链接</button><button class="primary-btn" @click="preview">推广海报</button></view>
          <view v-else-if="data.promotion" class="qr"><image :src="data.promotion.qrDataUrl" mode="aspectFit" /><text class="small">扫码进入商城</text></view>
        </view>
        <view class="metrics" aria-label="推广概览">
          <view class="card"><text class="small">已支付</text><b>{{ data.paidOrders }}</b></view>
          <view class="card"><text class="small">净销售</text><b>{{ money(data.netSalesCents) }}</b></view>
          <view class="card"><text class="small">已退款</text><b>{{ money(data.refundCents) }}</b></view>
        </view>
        <view class="card wallet-card">
          <view class="section-title">奖金明细</view>
          <view class="wallet-grid">
            <view><text class="small">冻结</text><b>{{ money(data.bonus.wallet?.frozenCents) }}</b></view>
            <view><text class="small">可提现</text><b>{{ money(data.bonus.wallet?.availableCents) }}</b></view>
            <view><text class="small">提现中</text><b>{{ money(data.bonus.wallet?.withdrawingCents) }}</b></view>
            <view><text class="small">待抵扣</text><b>{{ money(data.bonus.wallet?.debtCents) }}</b></view>
          </view>
          <text v-if="!data.bonus.wallet" class="small tip">账户数据暂未获取。</text>
          <view v-if="data.bonus.recentAccruals?.length" class="record-group"><h3>佣金记录</h3><view v-for="entry in data.bonus.recentAccruals" :key="entry.id" class="order-line"><text>{{ date(entry.createdAt) }} · {{ bonusStatus(entry.status) }}</text><text>{{ money(entry.grossBonusCents) }}<template v-if="entry.reversedBonusCents"> · 冲回 {{ money(entry.reversedBonusCents) }}</template></text></view></view>
        </view>
        <EmployeeWithdrawalPanel :employee-id="data.employee.id" :member-mode="memberMode" />
        <view class="card coupon-card">
          <view class="section-title">推广优惠券</view>
          <view v-for="coupon in coupons" :key="coupon.id" class="coupon-line">
            <view><b>{{ coupon.name }}</b><text class="small">可领 {{ coupon.remainingEmployeeQuota }} 张</text></view>
            <button class="outline-btn" :loading="claimingCouponId===coupon.id" :disabled="busy || !!claimingCouponId" @click="claimCoupon(coupon.id)">领取券码</button>
            <view v-for="gift in coupon.gifts || []" :key="gift.id" class="gift-line"><text selectable>{{ gift.code }} · {{ gift.status === 'RESERVED' ? '待领取' : gift.status === 'REDEEMED' ? '已领取' : gift.status }} {{ gift.redeemedAt ? date(gift.redeemedAt) : '' }}</text><button v-if="gift.linkUrl" class="mini-btn" @click="copy(gift.linkUrl)">复制链接</button><button v-if="gift.qrDataUrl" class="mini-btn" @click="previewQr(gift.qrDataUrl)">二维码</button><text v-if="!gift.linkUrl" class="small">链接仅在领取时展示</text></view>
          </view>
          <text v-if="couponLoadError" class="small section-error">{{ couponLoadError }}</text>
          <view v-else-if="!coupons.length" class="empty">暂无可领取的推广优惠券</view>
        </view>
        <view v-if="data.promotion" class="card assets">
          <view class="section-title">推广素材</view>
          <text v-if="productLoadError" class="small section-error">{{ productLoadError }}</text>
          <picker :range="['商城首页',...products.map(x=>x.name)]" :value="productIndex" @change="productIndex=Number($event.detail.value);productPromotion()"><view class="field"><text>推广商品</text><b>{{ productIndex ? products[productIndex-1]?.name : '商城首页' }} ›</b></view></picker>
          <view class="field"><text>推广码</text><b selectable>{{ data.promotion.referralCode }}</b></view>
          <view v-if="!memberMode" class="field"><text>推广链接</text><b selectable>{{ data.promotion.linkUrl }}</b></view>
          <view class="row-buttons"><button class="outline-btn" @click="copy(data.promotion.linkUrl)">复制链接</button><button class="primary-btn" @click="preview">查看推广海报</button></view>
        </view>
        <view class="card orders">
          <view class="section-title">推广订单</view>
          <view v-for="order in data.orders" :key="order.id" class="order-line"><view><b>{{ order.orderNo }}</b><text class="small">{{ order.user.nickname }} · {{ date(order.createdAt) }}</text></view><view><text>{{ money(order.payableCents) }}</text><text class="small">{{ orderStatus(order.status) }}</text></view></view>
          <view v-if="!data.orders.length" class="empty">暂无推广订单</view>
          <view class="pagination"><button size="mini" :disabled="page<=1 || busy" @click="page--;load()">上一页</button><text>第 {{ page }} 页 · 共 {{ data.pagination?.total ?? '未获取' }} 单</text><button size="mini" :disabled="!data.pagination?.hasMore || busy" @click="page++;load()">下一页</button></view>
          <text v-if="data.trendReason" class="small tip">{{ data.trendReason }}</text>
        </view>
      </template>
      <view v-else-if="authorized" class="card loading-state"><text>{{ loadError || '正在加载推广与奖金…' }}</text><button v-if="loadError" class="outline-btn" :disabled="busy" @click="load">重新加载</button></view>
    </view>
  </view>
</template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import EmployeeWithdrawalPanel from "../../components/EmployeeWithdrawalPanel.vue";
import { api, money, toast, API_BASE, requireLogin } from "../../api";
const token = ref(String(mallStorage.get("employee-token") || "")),
  memberMode = ref(Boolean(mallStorage.get("saidian-token")) || !token.value),
  authorized = ref(Boolean(mallStorage.get("saidian-token")) || Boolean(token.value)),
  data = ref<any>(),
  coupons = ref<any[]>([]),
  loginMessage = ref("请登录会员账号后查看自己的推广与奖金明细。"),
  loadError = ref("");
const demo=ref(false),demoToken=ref(''),busy=ref(false),page=ref(1),rangeIndex=ref(3),from=ref(''),to=ref(''),products=ref<any[]>([]),productIndex=ref(0),claimingCouponId=ref(''),couponLoadError=ref(''),productLoadError=ref('');
const ranges=[{key:'today',label:'今天'},{key:'7d',label:'近7天'},{key:'30d',label:'近30天'},{key:'month',label:'本月'},{key:'custom',label:'自定义'}];
let initialized = false;
onShow(()=>{
  if (!initialized) return;
  const hasMemberSession = Boolean(mallStorage.get("saidian-token"));
  if (hasMemberSession && !memberMode.value) {
    memberMode.value = true;
    token.value = "";
    authorized.value = true;
    void load();
    return;
  }
  if (hasMemberSession && memberMode.value && !data.value) {
    authorized.value = true;
    void load();
    return;
  }
  if (data.value) void load();
});
onLoad(async () => {
  const oauthCode = queryValue("code");
  const hasMemberSession = Boolean(mallStorage.get("saidian-token"));
  const enterpriseEntry = !hasMemberSession && Boolean(
    oauthCode || token.value || (typeof navigator !== "undefined" && /wxwork/i.test(navigator.userAgent)),
  );
  memberMode.value = !enterpriseEntry;
  authorized.value = memberMode.value ? hasMemberSession : Boolean(token.value);
  uni.setNavigationBarTitle({ title: memberMode.value ? "推广与奖金" : "员工推广中心" });
  initialized = true;
  if (!memberMode.value) {
    try{const caps:any=await api('/storefront/capabilities');demo.value=!!caps.demo;}catch{/* Login still reports its own failure. */}
  }
  if (!memberMode.value && oauthCode && !token.value) {
    try {
      const state = queryValue('state');
      if (typeof sessionStorage === 'undefined' || !state || sessionStorage.getItem('saidian-wecom-state') !== state) throw new Error('员工授权校验已失效，请重新从企业微信进入。');
      sessionStorage.removeItem('saidian-wecom-state');
      const r: any = await api("/wecom/oauth", {
        method: "POST",
        data: { code: oauthCode },
      });
      token.value = r.token;
      authorized.value = true;
      mallStorage.set("employee-token", r.token);
      cleanOAuthQuery();
    } catch (e) {
      loginMessage.value = errorMessage(e);
      toast(e);
    }
  }
  if (memberMode.value) {
    if (!hasMemberSession) {
      authorized.value = false;
      requireLogin("/pages/employee/index");
      return;
    }
    authorized.value = true;
    await load();
    return;
  }
  if (token.value) {
    authorized.value = true;
    await load();
    return;
  }
  await authorize();
});
async function load() {
  if (busy.value) return;
  const range=ranges[rangeIndex.value]!.key;
  if(range==='custom' && (!from.value||!to.value)){
    data.value=undefined;
    loadError.value="请选择开始和结束日期后查询。";
    return;
  }
  busy.value=true;
  loadError.value="";
  try {
    const query=new URLSearchParams({range,page:String(page.value),pageSize:'10',...(range==='custom'?{from:from.value,to:to.value}:{})});
    data.value = await promoterApi('/dashboard?'+query);
    couponLoadError.value="";
    try { coupons.value = await promoterApi("/coupons"); }
    catch { coupons.value=[]; couponLoadError.value="推广优惠券暂时无法读取，请稍后刷新。"; }
    productLoadError.value="";
    if(!products.value.length){
      try { const result:any=await api('/storefront/products?pageSize=100');products.value=result.items; }
      catch { products.value=[]; productLoadError.value="商品列表暂时无法读取，仍可分享商城首页。"; }
    }
    productIndex.value=0;
  } catch (e) {
    data.value=null;
    loadError.value=errorMessage(e);
    toast(e);
  } finally {
    busy.value=false;
  }
}
function changeRange(event: any) {
  rangeIndex.value=Number(event.detail.value);
  page.value=1;
  if(ranges[rangeIndex.value]?.key==='custom'){
    data.value=undefined;
    loadError.value="请选择开始和结束日期后查询。";
    return;
  }
  void load();
}
function promoterApi(path: string, method = "GET", body?: any, headers?: Record<string,string>) {
  if (memberMode.value) {
    return api(`/storefront/promoter${path}`, {
      method: method as any,
      auth: true,
      ...(body === undefined ? {} : { data: body }),
      ...(headers ? { headers } : {}),
    });
  }
  return employeeApi(`/wecom/me${path}`, method, body, headers);
}
function employeeApi(path: string, method = "GET", body?: any, headers?: Record<string,string>) {
  return new Promise<any>((resolve, reject) =>
    uni.request({
      url: `${API_BASE}${path}`,
      method: method as any,
      data: body,
      header: { authorization: `Bearer ${token.value}`, ...(headers || {}) },
      timeout:15000,
      success: (r) => {
        if(r.statusCode===401){token.value='';authorized.value=false;data.value=null;coupons.value=[];mallStorage.remove('employee-token');loginMessage.value='员工会话已过期，请重新从企业微信进入。';}
        r.statusCode < 300 ? resolve(r.data) : reject(new Error((r.data as any)?.message || '员工请求失败'));
      },
      fail: reject,
    }),
  );
}
async function claimCoupon(id: string) {
  if(busy.value||claimingCouponId.value)return;
  claimingCouponId.value=id;
  try {
    const rows = await promoterApi(`/coupons/${id}/claim`, "POST", { quantity: 1 });
    if (rows?.[0]?.linkUrl) copy(rows[0].linkUrl);
    await load();
    uni.showToast({ title: "券码已领取，链接已复制", icon: "none" });
  } catch (e) { toast(e); }
  finally { claimingCouponId.value=''; }
}
async function useDemoSession(){if(!demo.value||!demoToken.value.trim())return;memberMode.value=false;token.value=demoToken.value.trim();authorized.value=true;demoToken.value='';mallStorage.set('employee-token',token.value);await load();}
function logout(){token.value='';authorized.value=false;data.value=null;coupons.value=[];products.value=[];mallStorage.remove('employee-token');loginMessage.value='员工账号已退出，会员账号不受影响。';}
async function productPromotion(){try{const selected=products.value[productIndex.value-1];data.value.promotion=await promoterApi('/promotion'+(selected?'?productId='+encodeURIComponent(selected.id):''));}catch(e){toast(e);}}
function openLogin(){ requireLogin("/pages/employee/index"); }
function backToProfile(){ uni.switchTab({ url: "/pages/profile/index", fail: () => uni.reLaunch({ url: "/pages/profile/index" }) }); }
async function authorize() {
  try {
    if (typeof location === "undefined") return;
    if (!/wxwork/i.test(navigator.userAgent)) {
      loginMessage.value = "请从赛电企业微信工作台进入，系统将自动登录。";
      return;
    }
    loginMessage.value = "正在跳转企业微信身份认证…";
    const redirect = `${location.origin}${location.pathname}#/pages/employee/index`;
    const r: any = await api(
      `/wecom/authorize-url?redirectUri=${encodeURIComponent(redirect)}`,
    );
    const target=new URL(r.url);if(target.protocol!=='https:'||target.hostname!=='open.weixin.qq.com'||target.username||target.password)throw new Error('企业微信授权地址无效');
    const state=target.searchParams.get('state');if(!state)throw new Error('员工授权缺少安全校验参数');sessionStorage.setItem('saidian-wecom-state',state);location.href=target.href;
  } catch (e) {
    loginMessage.value = errorMessage(e);
    toast(e);
  }
}
function queryValue(name: string) {
  if (typeof location === "undefined") return "";
  return new URL(location.href).searchParams.get(name) || "";
}
function cleanOAuthQuery() {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  history.replaceState({}, "", `${location.pathname}#/pages/employee/index`);
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "企业微信登录失败");
}
function copy(value: string) {
  uni.setClipboardData({ data: value });
}
function preview() {
  uni.previewImage({
    urls: [
      data.value.promotion.posterDataUrl || data.value.promotion.qrDataUrl,
    ],
  });
}
function previewQr(url?: string) {
  if (url) uni.previewImage({ urls: [url] });
}
function date(v: string) {
  return new Date(v).toLocaleDateString();
}
function bonusStatus(value: string) {
  return ({
    FROZEN: "冻结中", AVAILABLE: "可提现", REVERSED: "已冲回", PAID: "已结算",
  } as Record<string, string>)[String(value || "").toUpperCase()] || '处理中';
}
function orderStatus(value: string) {
  return ({
    PENDING_PAYMENT: "待付款", PAID: "已支付", ERP_SYNCING: "处理中", WAITING_FULFILLMENT: "待发货",
    SHIPPED: "待收货", RECEIVED: "已完成", COMPLETED: "已完成", CANCELLED: "已取消",
    AFTER_SALE: "售后中", REFUNDED: "已退款", CLOSED: "已关闭",
  } as Record<string, string>)[String(value || "").toUpperCase()] || '处理中';
}
</script>
<style lang="scss">@import "../../global-ui.scss";</style>
<style scoped lang="scss">
.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.page-title{margin:0 0 20rpx;font-size:42rpx}.profile-link{width:auto;margin:0 0 20rpx}.loading-state{display:grid;gap:20rpx;text-align:center}.loading-state .outline-btn{margin:0 auto;min-width:220rpx}
.filters,.pagination{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:18px;font-size:14px}.filters button,.pagination button{margin:0}.range-picker{display:grid;grid-template-columns:auto auto 18px;align-items:center;gap:8px;min-height:44px}.range-picker .small{margin:0}.chevron{font-size:22px;color:var(--muted)}.demo-login{display:grid;gap:16px;margin-top:24px}.demo-login .input{max-width:100%;font-size:14px}
.employee-login{max-width:700rpx;margin:80rpx auto;text-align:center}.employee-login .logo{width:100rpx;height:100rpx;border-radius:30rpx;background:#20a86f;color:#fff;display:flex;align-items:center;justify-content:center;margin:auto;font-size:48rpx}.employee-login>text,.employee-login>.small{display:block}.employee-login>text{font-size:38rpx;font-weight:900;margin-top:24rpx}.employee-login>.small{color:var(--muted);line-height:1.7;margin:18rpx 0 30rpx}
.employee-head{display:flex;align-items:center;justify-content:space-between;gap:18px;background:linear-gradient(135deg,#12335e,#2868ab);color:#fff}.promotion-summary{display:flex;align-items:center;gap:14px;min-width:0}.promotion-copy{min-width:0}.promotion-copy>.small,.promotion-copy>.legacy-amount,.promotion-copy>b,.referral-code{display:block}.legacy-amount{font-size:54rpx;font-weight:900;margin:12rpx 0}.promotion-copy>b{color:#d2e8e2;overflow-wrap:anywhere}.referral-code{margin-top:4px;font-size:13px;opacity:.78}.qr{background:#fff;padding:12rpx;border-radius:16rpx;text-align:center;color:#52615d;flex:none}.qr image{width:160rpx;height:160rpx}.qr .small{display:block}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16rpx;margin:20rpx 0}.metrics .small,.metrics b{display:block}.metrics b{font-size:32rpx;color:var(--green);margin-top:10rpx;overflow-wrap:anywhere}
.assets,.wallet-card,.coupon-card,.orders{margin-bottom:20rpx}.section-title{margin:0 0 16rpx}.wallet-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12rpx}.wallet-grid>view{min-width:0;background:#f3f8f6;padding:18rpx;border-radius:14rpx}.wallet-grid text,.wallet-grid b{display:block}.wallet-grid b{margin-top:8rpx;color:var(--green);overflow-wrap:anywhere}.tip{display:block;margin-top:18rpx;color:var(--muted);line-height:1.6}.record-group{margin-top:24rpx}.record-group h3{margin:0 0 10rpx;font-size:30rpx}
.coupon-line,.gift-line{border-top:1px solid var(--line);padding:16rpx 0}.coupon-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12rpx;align-items:center}.coupon-line>view:first-child{min-width:0}.coupon-line>view:first-child b,.coupon-line>view:first-child text{display:block}.coupon-line>.outline-btn{min-width:150rpx;margin:0}.gift-line{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:10rpx;flex-wrap:wrap}.gift-line>text:first-child{min-width:0;overflow-wrap:anywhere}.mini-btn{width:auto;min-height:44px;margin:0;padding:8px 10px;background:transparent;color:var(--green);font-size:24rpx}.section-error{display:block;padding:12px;border-radius:10px;background:#fff0f0;color:#b3261e;line-height:1.6}
.field{display:flex;justify-content:space-between;align-items:center;gap:18rpx;min-height:54px;padding:12rpx 0;border-top:1px solid var(--line)}.field b{max-width:68%;text-align:right;word-break:break-all}.row-buttons,.hero-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.row-buttons{margin-top:20rpx}.row-buttons button,.hero-actions button{width:100%;margin:0}
.order-line{display:flex;justify-content:space-between;gap:16px;padding:20rpx 0;border-top:1px solid var(--line)}.order-line>view{min-width:0}.order-line>view:first-child{overflow-wrap:anywhere}.order-line .small{display:block;color:var(--muted);margin-top:6rpx}.order-line>view:last-child{flex:none;text-align:right}.order-line>view:last-child>text:first-child{color:#d95f29;font-weight:800}.pagination{justify-content:space-between;margin:12rpx 0 0}.pagination text{text-align:center;flex:1}.empty{padding:52rpx 20rpx}
.promotion-surface{padding-top:18px}.promotion-content{max-width:600px}.promotion-surface .page-heading{display:grid;grid-template-columns:1fr auto 1fr;margin-bottom:18px}.promotion-surface .page-title{grid-column:2;margin:0;text-align:center;font-size:20px}.promotion-surface .profile-link{grid-column:3;justify-self:end;margin:0;padding-inline:0}.promotion-surface .card{padding:20px;border:1px solid var(--line);border-radius:18px}.promotion-surface .filters{margin-bottom:18px;padding-block:8px}.promotion-surface .filters>picker:first-child{width:100%}.promotion-surface .range-picker{grid-template-columns:1fr auto 18px}.member-promotion-hero{display:grid;background:linear-gradient(135deg,#fff8f3,#ffecee);color:var(--ink);border-color:#f0d9dd;box-shadow:0 10px 22px #9e102509}.promotion-avatar{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;flex:none;background:#fff;color:#d20b27;font-size:28px;font-weight:800}.member-promotion-hero .promotion-copy>.small{margin-bottom:5px}.member-promotion-hero .promotion-copy>b{color:var(--ink)}.member-promotion-hero .hero-actions{margin-top:18px}.promotion-surface .metrics{gap:10px;margin:14px 0 18px}.promotion-surface .metrics .card{padding:14px 12px}.promotion-surface .metrics b{font-size:18px}.promotion-surface .section-title{font-size:19px;margin:0 0 16px}.promotion-surface .wallet-card,.promotion-surface .coupon-card,.promotion-surface .assets,.promotion-surface .orders{margin-bottom:18px}.promotion-surface .wallet-grid>view{padding:14px;border-radius:12px;background:#fff7f8}.promotion-surface .wallet-grid b{color:#d20b27}.promotion-surface .mini-btn{font-size:13px}.promotion-surface .pagination button{min-height:44px}
@media(min-width:520px){.wallet-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:420px){.promotion-surface{padding-inline:14px}.promotion-surface .page-heading{grid-template-columns:72px 1fr 72px}.promotion-surface .profile-link{font-size:13px}.promotion-surface .metrics .card{padding:12px 8px}.promotion-surface .metrics .small{font-size:12px}.promotion-surface .metrics b{font-size:16px}.coupon-line{grid-template-columns:minmax(0,1fr) 92px}.coupon-line>.outline-btn{min-width:0;padding-inline:8px}.pagination{gap:8px}.pagination text{font-size:12px}.row-buttons,.hero-actions{gap:8px}}
</style>
