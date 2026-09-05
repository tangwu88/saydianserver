<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view v-if="!token" class="card employee-login"
        ><view class="logo">企</view><text>赛电商城推广中心</text
        ><text class="small"
          >{{ loginMessage }}</text
        ></view
      ><template v-else-if="data"
        ><view class="employee-head card"
          ><view
            ><text class="small">本月净销售额</text
            ><text>{{ money(data.netSalesCents) }}</text
            ><b
              >{{ data.employee.name }} · 推荐号
              {{ data.employee.referralCode }}</b
            ></view
          ><view class="qr"
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
            ><view><text class="small">冻结奖金</text><b>{{ money(data.bonus.wallet.frozenCents) }}</b></view
            ><view><text class="small">可提现</text><b>{{ money(data.bonus.wallet.availableCents) }}</b></view
            ><view><text class="small">提现中</text><b>{{ money(data.bonus.wallet.withdrawingCents) }}</b></view
            ><view><text class="small">待抵扣</text><b>{{ money(data.bonus.wallet.debtCents) }}</b></view
          ></view
          ><text class="small tip">历史提现记录仅供查看，当前不提供新的提现交易。</text
          ><view v-for="item in data.bonus.recentWithdrawals" :key="item.id" class="withdraw-item"
            ><view><b>{{ money(item.amountCents) }}</b><text class="small">{{ withdrawalStatus(item.status) }}</text></view></view
        ></view
        ><view class="card coupon-card"
          ><view class="section-title">员工优惠券</view
          ><view v-for="coupon in coupons" :key="coupon.id" class="coupon-line"
            ><view><b>{{ coupon.name }}</b><text class="small">剩余可领 {{ coupon.remainingEmployeeQuota }} 张</text></view
            ><view class="outline-btn" @click="claimCoupon(coupon.id)">领取券码</view
            ><view v-for="gift in reservedGifts(coupon)" :key="gift.id" class="gift-line"
              ><text selectable>{{ gift.code }}</text
              ><view v-if="gift.linkUrl" class="mini-btn" @click="copy(gift.linkUrl)">复制链接</view
              ><view v-if="gift.qrDataUrl" class="mini-btn" @click="previewQr(gift.qrDataUrl)">二维码</view
              ><text v-if="!gift.linkUrl" class="small">链接仅在领取时展示</text></view
          ></view
          ><view v-if="!coupons.length" class="empty">暂无可领取的员工优惠券</view
        ></view
        ><view class="card assets"
          ><view class="section-title">推广素材</view
          ><view class="field"
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
            >暂无推广订单</view
          ></view
        ></template
      ></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money, toast } from "../../api";
const token = ref(String(uni.getStorageSync("employee-token") || "")),
  data = ref<any>(),
  coupons = ref<any[]>([]),
  loginMessage = ref("正在识别企业微信员工身份…");
onLoad(async () => {
  const oauthCode = queryValue("code");
  if (oauthCode && !token.value) {
    try {
      const r: any = await api("/wecom/oauth", {
        method: "POST",
        data: { code: oauthCode },
      });
      token.value = r.token;
      uni.setStorageSync("employee-token", r.token);
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
  try {
    const [dashboard, couponRows] = await Promise.all([
      employeeApi("/wecom/me/dashboard"),
      employeeApi("/wecom/me/coupons"),
    ]);
    data.value = dashboard;
    coupons.value = couponRows;
  } catch (e) {
    toast(e);
  }
}
function employeeApi(path: string, method = "GET", body?: any, headers?: Record<string,string>) {
  return new Promise<any>((resolve, reject) =>
    uni.request({
      url: `${import.meta.env.VITE_API_BASE || "/api/saidian-mall/v1"}${path}`,
      method: method as any,
      data: body,
      header: { authorization: `Bearer ${token.value}`, ...(headers || {}) },
      success: (r) =>
        r.statusCode < 300
          ? resolve(r.data)
          : reject(new Error((r.data as any)?.message || "登录失效")),
      fail: reject,
    }),
  );
}
async function claimCoupon(id: string) {
  try {
    const rows = await employeeApi(`/wecom/me/coupons/${id}/claim`, "POST", { quantity: 1 });
    if (rows?.[0]?.linkUrl) copy(rows[0].linkUrl);
    await load();
    uni.showToast({ title: "券码已领取，链接已复制", icon: "none" });
  } catch (e) { toast(e); }
}
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
    location.href = r.url;
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
  } as Record<string, string>)[String(value || "").toUpperCase()] || "历史记录";
}
</script>
<style scoped lang="scss">
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
  background: linear-gradient(135deg, #153f39, #287d6c);
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
