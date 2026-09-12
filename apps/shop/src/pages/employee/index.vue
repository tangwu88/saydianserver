<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view v-if="!token" class="card employee-login"
        ><view class="logo">企</view><text>赛电商城推广中心</text
        ><text class="small"
          >{{ loginMessage }}</text>
          <view v-if="demo" class="demo-login"><text class="small">隔离演示：使用本机私有运行目录的员工测试会话，不连接企业微信。</text><input v-model="demoToken" password class="input" placeholder="粘贴本地员工测试会话"/><button class="primary-btn" @click="useDemoSession">进入测试工作台</button></view>
        </view
      ><template v-else-if="data"
        ><view class="card filters"><picker :range="ranges.map(x=>x.label)" :value="rangeIndex" @change="rangeIndex=Number($event.detail.value);page=1;load()"><view>业绩范围：{{ ranges[rangeIndex]?.label }} ▾</view></picker><template v-if="ranges[rangeIndex]?.key==='custom'"><picker mode="date" :value="from" @change="from=String($event.detail.value)"><view>开始：{{ from || '选择日期' }}</view></picker><picker mode="date" :value="to" @change="to=String($event.detail.value)"><view>结束：{{ to || '选择日期' }}</view></picker><button size="mini" @click="page=1;load()">查询</button></template><button size="mini" @click="logout">退出员工账号</button></view><view class="employee-head card"
          ><view
            ><text class="small">所选期间净销售额</text
            ><text>{{ money(data.netSalesCents) }}</text
            ><b
              >{{ data.employee.name }} · 推荐号
              {{ data.employee.referralCode }}</b
            ></view
          ><view v-if="data.promotion" class="qr"
            ><image :src="data.promotion.qrDataUrl" mode="aspectFit" /><text
              class="small"
              >扫码进入商城</text
            ></view
          ></view
        ><view class="metrics"
          ><view class="card"
            ><text class="small">已支付订单</text
            ><b>{{ data.paidOrders }}</b></view
          ><view class="card"
            ><text class="small">销售额</text
            ><b>{{ money(data.salesCents) }}</b></view
          ><view class="card"
            ><text class="small">退款额</text
            ><b>{{ money(data.refundCents) }}</b></view
          ></view
        ><view class="card wallet-card"
          ><view class="section-title">推荐奖金</view
          ><view class="wallet-grid"
            ><view><text class="small">冻结奖金</text><b>{{ money(data.bonus.wallet?.frozenCents) }}</b></view
            ><view><text class="small">可提现</text><b>{{ money(data.bonus.wallet?.availableCents) }}</b></view
            ><view><text class="small">提现中</text><b>{{ money(data.bonus.wallet?.withdrawingCents) }}</b></view
            ><view><text class="small">待抵扣</text><b>{{ money(data.bonus.wallet?.debtCents) }}</b></view
          ></view
          ><text class="small tip">{{ data.bonus.wallet ? '冻结奖金不可提现，提现资格以服务端实时核验为准。' : '奖金账户尚未获取，不代表余额为零。' }}</text>
          <view v-if="data.bonus.recentAccruals?.length"><h3>所选期间佣金记录</h3><view v-for="entry in data.bonus.recentAccruals" :key="entry.id" class="order-line"><text>{{ date(entry.createdAt) }} · {{ entry.status }}</text><text>{{ money(entry.grossBonusCents) }} / 冲回 {{ money(entry.reversedBonusCents) }}</text></view></view
          ><view v-for="item in data.bonus.recentWithdrawals" :key="item.id" class="withdraw-item"
            ><view><b>{{ money(item.amountCents) }}</b><text class="small">{{ withdrawalStatus(item.status) }}</text></view></view
        ></view
        ><EmployeeWithdrawalPanel :employee-id="data.employee.id" /><view class="card coupon-card"
          ><view class="section-title">员工优惠券</view
          ><view v-for="coupon in coupons" :key="coupon.id" class="coupon-line"
            ><view><b>{{ coupon.name }}</b><text class="small">剩余可领 {{ coupon.remainingEmployeeQuota }} 张</text></view
            ><view class="outline-btn" @click="claimCoupon(coupon.id)">领取券码</view
            ><view v-for="gift in coupon.gifts || []" :key="gift.id" class="gift-line"
              ><text selectable>{{ gift.code }} · {{ gift.status === 'RESERVED' ? '待领取' : gift.status === 'REDEEMED' ? '已领取' : gift.status }} {{ gift.redeemedAt ? date(gift.redeemedAt) : '' }}</text
              ><view v-if="gift.linkUrl" class="mini-btn" @click="copy(gift.linkUrl)">复制链接</view
              ><view v-if="gift.qrDataUrl" class="mini-btn" @click="previewQr(gift.qrDataUrl)">二维码</view
              ><text v-if="!gift.linkUrl" class="small">链接仅在领取时展示</text></view
          ></view
          ><view v-if="!coupons.length" class="empty">暂无可领取的员工优惠券</view
        ></view
        ><view v-if="data.promotion" class="card assets"
          ><view class="section-title">推广素材</view
          ><picker :range="['商城首页',...products.map(x=>x.name)]" :value="productIndex" @change="productIndex=Number($event.detail.value);productPromotion()"><view class="field">推广商品：{{ productIndex ? products[productIndex-1]?.name : '商城首页' }} ▾</view></picker><view class="field"
            ><text>推荐号</text
            ><b selectable>{{ data.promotion.referralCode }}</b></view
          ><view class="field"
            ><text>推广链接</text
            ><b selectable>{{ data.promotion.linkUrl }}</b></view
          ><view class="row-buttons"
            ><view class="outline-btn" @click="copy(data.promotion.linkUrl)"
              >复制链接</view
            ><view class="primary-btn" @click="preview"
              >查看推广海报</view
            ></view
          ></view
        ><view class="card orders"
          ><view class="section-title">我的推广订单</view
          ><view v-for="order in data.orders" :key="order.id" class="order-line"
            ><view
              ><b>{{ order.orderNo }}</b
              ><text class="small"
                >{{ order.user.nickname }} · {{ date(order.createdAt) }}</text
              ></view
            ><view
              ><text>{{ money(order.payableCents) }}</text
              ><text class="small">{{ order.status }}</text></view
            ></view
          ><view v-if="!data.orders.length" class="empty"
            >暂无推广订单</view>
          <view class="pagination"><button size="mini" :disabled="page<=1 || busy" @click="page--;load()">上一页</button><text>第 {{ page }} 页 · 共 {{ data.pagination?.total ?? '未获取' }} 单</text><button size="mini" :disabled="!data.pagination?.hasMore || busy" @click="page++;load()">下一页</button></view><text class="small tip">销售按付款时间、退款按完成时间、订单列表按创建时间筛选；北京时间。{{ data.trendReason || '' }}</text></view
        ></template
      ></view
    ></view
  >
</template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import EmployeeWithdrawalPanel from "../../components/EmployeeWithdrawalPanel.vue";
import { api, money, toast, API_BASE } from "../../api";
const token = ref(String(mallStorage.get("employee-token") || "")),
  data = ref<any>(),
  coupons = ref<any[]>([]),
  loginMessage = ref("正在识别企业微信员工身份…");
const demo=ref(false),demoToken=ref(''),busy=ref(false),page=ref(1),rangeIndex=ref(3),from=ref(''),to=ref(''),products=ref<any[]>([]),productIndex=ref(0);
const ranges=[{key:'today',label:'今天'},{key:'7d',label:'近7天'},{key:'30d',label:'近30天'},{key:'month',label:'本月'},{key:'custom',label:'自定义'}];
onShow(()=>{if(data.value)void load();});
onLoad(async () => {
  try{const caps:any=await api('/storefront/capabilities');demo.value=!!caps.demo;}catch{/* Login still reports its own failure. */}
  const oauthCode = queryValue("code");
  if (oauthCode && !token.value) {
    try {
      const state = queryValue('state');
      if (typeof sessionStorage === 'undefined' || !state || sessionStorage.getItem('saidian-wecom-state') !== state) throw new Error('员工授权校验已失效，请重新从企业微信进入。');
      sessionStorage.removeItem('saidian-wecom-state');
      const r: any = await api("/wecom/oauth", {
        method: "POST",
        data: { code: oauthCode },
      });
      token.value = r.token;
      mallStorage.set("employee-token", r.token);
      cleanOAuthQuery();
    } catch (e) {
      loginMessage.value = errorMessage(e);
      toast(e);
    }
  }
  if (token.value) {
    await load();
    return;
  }
  await authorize();
});
async function load() {
  if (busy.value) return;
  busy.value=true;
  try {
    const range=ranges[rangeIndex.value]!.key;
    if(range==='custom' && (!from.value||!to.value))return;
    const query=new URLSearchParams({range,page:String(page.value),pageSize:'10',...(range==='custom'?{from:from.value,to:to.value}:{})});
    const [dashboard, couponRows] = await Promise.all([
      employeeApi('/wecom/me/dashboard?'+query),
      employeeApi("/wecom/me/coupons"),
    ]);
    data.value = dashboard;
    coupons.value = couponRows;
    if(!products.value.length){const result:any=await api('/storefront/products?pageSize=100');products.value=result.items;}
    productIndex.value=0;
  } catch (e) {
    data.value=null;
    toast(e);
  } finally {
    busy.value=false;
  }
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
        if(r.statusCode===401){token.value='';data.value=null;coupons.value=[];mallStorage.remove('employee-token');loginMessage.value='员工会话已过期，请重新从企业微信进入。';}
        r.statusCode < 300 ? resolve(r.data) : reject(new Error((r.data as any)?.message || '员工请求失败'));
      },
      fail: reject,
    }),
  );
}
async function claimCoupon(id: string) {
  if(busy.value)return;
  try {
    const rows = await employeeApi(`/wecom/me/coupons/${id}/claim`, "POST", { quantity: 1 });
    if (rows?.[0]?.linkUrl) copy(rows[0].linkUrl);
    await load();
    uni.showToast({ title: "券码已领取，链接已复制", icon: "none" });
  } catch (e) { toast(e); }
}
async function useDemoSession(){if(!demo.value||!demoToken.value.trim())return;token.value=demoToken.value.trim();demoToken.value='';mallStorage.set('employee-token',token.value);await load();}
function logout(){token.value='';data.value=null;coupons.value=[];products.value=[];mallStorage.remove('employee-token');loginMessage.value='员工账号已退出，顾客账号不受影响。';}
async function productPromotion(){try{const selected=products.value[productIndex.value-1];data.value.promotion=await employeeApi('/wecom/me/promotion'+(selected?'?productId='+encodeURIComponent(selected.id):''));}catch(e){toast(e);}}
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
function reservedGifts(coupon: any) {
  return (coupon?.gifts || []).filter((gift: any) => gift.status === "RESERVED");
}
function date(v: string) {
  return new Date(v).toLocaleDateString();
}
function withdrawalStatus(value: string) {
  return ({
    PAID: "已完成",
    COMPLETED: "已完成",
    FAILED: "未完成",
    CANCELLED: "已取消",
    REJECTED: "已拒绝",
    REQUESTED: '待审核', APPROVED: '已批准', PROCESSING: '打款处理中', UNKNOWN: '渠道结果待确认',
  } as Record<string, string>)[String(value || "").toUpperCase()] || value || '未获取';
}
</script>
<style scoped lang="scss">
.filters,.pagination{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:18px;font-size:14px}.filters button,.pagination button{margin:0}.demo-login{display:grid;gap:16px;margin-top:24px}.demo-login .input{max-width:100%;font-size:14px}
.employee-login {
  max-width: 700rpx;
  margin: 80rpx auto;
  text-align: center;
}
.employee-login .logo {
  width: 100rpx;
  height: 100rpx;
  border-radius: 30rpx;
  background: #20a86f;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: auto;
  font-size: 48rpx;
}
.employee-login > text,
.employee-login > .small {
  display: block;
}
.employee-login > text {
  font-size: 38rpx;
  font-weight: 900;
  margin-top: 24rpx;
}
.employee-login > .small {
  color: var(--muted);
  line-height: 1.7;
  margin: 18rpx 0 30rpx;
}
.employee-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #12335e, #2868ab);
  color: #fff;
}
.employee-head .small,
.employee-head text,
.employee-head b {
  display: block;
}
.employee-head text {
  font-size: 54rpx;
  font-weight: 900;
  margin: 12rpx 0;
}
.employee-head b {
  color: #d2e8e2;
}
.qr {
  background: #fff;
  padding: 12rpx;
  border-radius: 16rpx;
  text-align: center;
  color: #52615d;
}
.qr image {
  width: 160rpx;
  height: 160rpx;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  margin: 20rpx 0;
}
.metrics .small,
.metrics b {
  display: block;
}
.metrics b {
  font-size: 32rpx;
  color: var(--green);
  margin-top: 10rpx;
}
.assets {
  margin-bottom: 20rpx;
}
.wallet-card,
.coupon-card { margin-bottom: 20rpx; }
.wallet-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12rpx; }
.wallet-grid > view { background: #f3f8f6; padding: 18rpx; border-radius: 14rpx; }
.wallet-grid text,.wallet-grid b { display: block; }
.wallet-grid b { margin-top: 8rpx; color: var(--green); }
.tip { display: block; margin-top: 18rpx; color: var(--muted); }
.withdraw-item,.coupon-line,.gift-line { border-top: 1px solid var(--line); padding: 16rpx 0; }
.withdraw-item,.coupon-line > view:first-child,.gift-line { display: flex; justify-content: space-between; align-items: center; }
.coupon-line > .outline-btn { margin: 12rpx 0; }
.gift-line { gap: 10rpx; }
.mini-btn { color: var(--green); font-size: 24rpx; }
.field {
  display: flex;
  justify-content: space-between;
  padding: 18rpx 0;
  border-top: 1px solid var(--line);
}
.field b {
  max-width: 68%;
  text-align: right;
  word-break: break-all;
}
.row-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14rpx;
  margin-top: 20rpx;
}
.order-line {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 0;
  border-top: 1px solid var(--line);
}
.order-line .small {
  display: block;
  color: var(--muted);
  margin-top: 6rpx;
}
.order-line > view:last-child {
  text-align: right;
}
.order-line > view:last-child text {
  color: #d95f29;
  font-weight: 800;
}
</style>
