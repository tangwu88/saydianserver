<template>
  <DesktopHeader /><view class="page"
    ><view class="container checkout-layout"
      ><view
        ><view class="card address-card" @click="chooseAddress"
          ><template v-if="address"
            ><view class="row between"
              ><b>{{ address.name }} {{ address.mobile }}</b
              ><text>更换 ›</text></view
            ><text class="small"
              >{{ address.province }}{{ address.city }}{{ address.district
              }}{{ address.detail }}</text
            ></template
          ><template v-else><text>＋ 添加收货地址</text></template></view
        ><view class="card goods"
          ><view class="section-label">商品清单</view
          ><view v-for="item in items" :key="item.skuId" class="goods-item"
            ><image
              :src="
                item.sku?.image ||
                item.product?.coverImage ||
                productPlaceholder
              "
              mode="aspectFill"
            /><view
              ><b>{{ item.product?.displayName || item.product?.name }}</b
              ><text class="small">{{
                item.sku?.specification || item.sku?.erpSkuId
              }}</text
              ><view class="row between"
                ><text class="amount">{{
                  money(item.sku?.salePriceCents)
                }}</text
                ><text>× {{ item.quantity }}</text></view
              ></view
            ></view
          ></view
        ><view class="card form-card"
          ><view class="section-label">订单信息</view
          ><view class="field"
            ><text>优惠券</text
            ><picker :range="couponLabels" @change="selectCoupon"
              ><view
                >{{ selectedCoupon?.coupon?.name || "不使用优惠券" }} ›</view
              ></picker
            ></view
          ><view class="field"
            ><text>买家留言</text
            ><input v-model="remark" placeholder="选填，可填写配送要求" /></view
          ><view class="field"
            ><text>发票信息</text
            ><input
              v-model="invoiceTitle"
              placeholder="选填，填写发票抬头" /></view></view></view
      ><view class="card settle"
        ><view
          ><text>商品金额</text><b>{{ money(subtotal) }}</b></view
        ><view
          ><text>优惠金额</text><b>-{{ money(discount) }}</b></view
        ><view><text>运费</text><b>下单后确认</b></view
        ><view class="total"
          ><text>应付金额</text><b>{{ money(subtotal - discount) }}</b></view
        ><view class="payment-title">支付方式</view
        ><view v-if="isWechatH5" class="mini-payment-tip"
          ><b>请在赛电商城小程序完成下单与微信支付</b
          ><text>微信内 H5 不再调用公众号授权或 JSAPI 支付。</text></view
        >
        <view class="payment-options"
          ><view
            v-for="item in channels"
            :key="item.value"
            :class="channel === item.value && 'active'"
            @click="channel = item.value"
            ><view
              ><b>{{ item.label }}</b
              ><text class="small">{{ item.help }}</text></view
            ></view
          ></view
        ><view
          :class="['primary-btn', submitting && 'disabled']"
          @click="submit"
          >{{ submitting ? "提交中…" : "提交订单并支付" }}</view
        ></view
      ></view
    ></view
  >
  <view v-if="paymentQr" class="qr-mask">
    <view class="qr-dialog">
      <text>微信扫码支付</text>
      <image :src="paymentQr" mode="aspectFit" />
      <text class="small">请使用微信扫码完成支付</text>
      <view class="primary-btn" @click="finishQrPayment">我已完成支付</view>
      <view class="outline-btn" @click="paymentQr = ''">稍后支付</view>
    </view>
  </view>
</template>
<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money, productPlaceholder, toast } from "../../api";
const items = ref<any[]>([]),
  addresses = ref<any[]>([]),
  address = ref<any>(),
  coupons = ref<any[]>([]),
  selectedCoupon = ref<any>(),
  remark = ref(""),
  invoiceTitle = ref(""),
  submitting = ref(false),
  paymentQr = ref(""),
  pendingOrderId = ref("");
const isDesktop = typeof window !== "undefined" && window.innerWidth >= 900;
const isWechatH5 =
  typeof navigator !== "undefined" &&
  /MicroMessenger/i.test(navigator.userAgent);
const channels = ref<any[]>([]),
  channel = ref("");
/* #ifdef MP-WEIXIN */ channels.value = [
  {
    value: "WECHAT_MINI",
    label: "微信支付",
    help: "微信小程序安全支付",
  },
];
/* #endif */ /* #ifdef H5 */ channels.value = isWechatH5
  ? []
  : [
      {
        value: isDesktop ? "WECHAT_NATIVE" : "WECHAT_H5",
        label: "微信支付",
        help: isDesktop ? "扫码完成支付" : "跳转微信支付",
      },
      {
        value: isDesktop ? "ALIPAY_PAGE" : "ALIPAY_WAP",
        label: "支付宝",
        help: isDesktop ? "电脑网页支付" : "手机网页支付",
      },
    ];
/* #endif */ channel.value = channels.value[0]?.value || "";
const subtotal = computed(() =>
  items.value.reduce(
    (s, x) => s + (x.sku?.salePriceCents || 0) * x.quantity,
    0,
  ),
);
const discount = computed(() =>
  selectedCoupon.value &&
  subtotal.value >= selectedCoupon.value.coupon.minimumSpendCents
    ? Math.min(subtotal.value, selectedCoupon.value.coupon.value)
    : 0,
);
const couponLabels = computed(() => [
  "不使用优惠券",
  ...coupons.value
    .filter((x) => !x.usedAt)
    .map((x) => `${x.coupon.name} - ${money(x.coupon.value)}`),
]);
onShow(async () => {
  items.value = uni.getStorageSync("checkout-items") || [];
  try {
    addresses.value = await api("/storefront/addresses", { auth: true });
    address.value =
      uni.getStorageSync("checkout-address") ||
      addresses.value.find((x) => x.isDefault) ||
      addresses.value[0];
    uni.removeStorageSync("checkout-address");
    coupons.value = await api("/storefront/coupons", { auth: true });
  } catch (e) {
    toast(e);
  }
});
function chooseAddress() {
  if (!addresses.value.length)
    return uni.navigateTo({ url: "/pages/address-edit/index" });
  uni.navigateTo({ url: "/pages/addresses/index?select=1" });
}
function selectCoupon(e: any) {
  selectedCoupon.value =
    e.detail.value > 0
      ? coupons.value.filter((x) => !x.usedAt)[e.detail.value - 1]
      : undefined;
}
async function submit() {
  if (submitting.value) return;
  if (!channel.value)
    return uni.showModal({
      title: "请使用赛电商城小程序",
      content: "微信登录、下单和微信支付已统一放到小程序内完成。",
      showCancel: false,
    });
  if (!address.value) return toast("请先添加收货地址");
  if (!items.value.length) return toast("结算商品为空");
  submitting.value = true;
  try {
    const order: any = await api("/storefront/orders", {
      method: "POST",
      auth: true,
      headers: {
        "idempotency-key": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      data: {
        addressId: address.value.id,
        items: items.value.map((x) => ({
          skuId: x.skuId,
          quantity: x.quantity,
        })),
        couponClaimId: selectedCoupon.value?.id,
        buyerRemark: remark.value,
        invoice: invoiceTitle.value ? { title: invoiceTitle.value } : undefined,
      },
    });
    const payment: any = await api("/payments/create", {
      method: "POST",
      auth: true,
      data: { orderId: order.id, channel: channel.value },
    });
    pendingOrderId.value = order.id;
    if (await invoke(payment.invoke)) {
      uni.removeStorageSync("checkout-items");
      uni.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` });
    }
  } catch (e) {
    toast(e);
  } finally {
    submitting.value = false;
  }
}
async function invoke(i: any): Promise<boolean> {
  if (i.type === "REDIRECT" && typeof location !== "undefined") {
    location.href = i.url;
    return false;
  }
  if (i.type === "FORM" && typeof document !== "undefined") {
    const form = document.createElement("form");
    form.method = i.method;
    form.action = i.url;
    Object.entries(i.fields).forEach(([k, v]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = k;
      input.value = String(v);
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    return false;
  }
  if (i.type === "QR") {
    paymentQr.value = i.qrDataUrl || i.codeUrl;
    return false;
  }
  if (i.type === "JSAPI") {
    /* #ifdef MP-WEIXIN */
    const {
      timeStamp,
      nonceStr,
      package: paymentPackage,
      signType,
      paySign,
    } = i;
    await new Promise((resolve, reject) =>
      uni.requestPayment({
        timeStamp,
        nonceStr,
        package: paymentPackage,
        signType,
        paySign,
        success: resolve,
        fail: (error: any) =>
          reject(
            new Error(
              /cancel/i.test(String(error?.errMsg || ""))
                ? "已取消支付"
                : String(error?.errMsg || "微信支付失败"),
            ),
          ),
      } as any),
    );
    /* #endif */
    return true;
  }
  return false;
}
function finishQrPayment() {
  uni.removeStorageSync("checkout-items");
  uni.redirectTo({
    url: `/pages/order-detail/index?id=${pendingOrderId.value}`,
  });
}
</script>
<style scoped lang="scss">
.checkout-layout {
  display: grid;
  gap: 22rpx;
}
.checkout-layout > view {
  display: grid;
  gap: 22rpx;
}
.address-card .small {
  display: block;
  color: var(--muted);
  margin-top: 16rpx;
  line-height: 1.6;
}
.section-label {
  font-size: 30rpx;
  font-weight: 850;
  margin-bottom: 20rpx;
}
.goods-item {
  display: grid;
  grid-template-columns: 140rpx 1fr;
  gap: 18rpx;
  padding: 18rpx 0;
  border-top: 1px solid var(--line);
}
.goods-item image {
  width: 140rpx;
  height: 140rpx;
  border-radius: 14rpx;
}
.goods-item b,
.goods-item .small {
  display: block;
}
.goods-item .small {
  color: var(--muted);
  margin: 10rpx 0;
}
.field {
  min-height: 86rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--line);
}
.field input,
.field picker {
  flex: 1;
  text-align: right;
  margin-left: 24rpx;
}
.settle > view:not(.primary-btn):not(.payment-options):not(.payment-title) {
  display: flex;
  justify-content: space-between;
  margin-bottom: 22rpx;
}
.settle .total {
  padding-top: 22rpx;
  border-top: 1px solid var(--line);
}
.total b {
  color: var(--green);
  font-size: 36rpx;
}
.payment-title {
  font-weight: 850;
  margin: 30rpx 0 18rpx;
}
.mini-payment-tip {
  padding: 22rpx;
  margin-bottom: 20rpx;
  border-radius: 14rpx;
  background: #edf7f3;
  color: #176b5b;
}
.mini-payment-tip b,
.mini-payment-tip text {
  display: block;
}
.mini-payment-tip text {
  margin-top: 8rpx;
  color: var(--muted);
  font-size: 22rpx;
}
.payment-options {
  display: grid;
  gap: 12rpx;
  margin-bottom: 26rpx;
}
.payment-options > view {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 20rpx;
  border: 1px solid var(--line);
  border-radius: 14rpx;
}
.payment-options > view.active {
  border-color: var(--green);
  background: var(--mint);
}
.payment-options b,
.payment-options .small {
  display: block;
}
.payment-options .small {
  color: var(--muted);
  font-size: 20rpx;
  margin-top: 5rpx;
}
.disabled {
  opacity: 0.55;
}
.qr-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30rpx;
  background: rgba(7, 27, 24, 0.65);
}
.qr-dialog {
  width: 620rpx;
  max-width: 420px;
  padding: 36rpx;
  border-radius: 24rpx;
  background: #fff;
  text-align: center;
}
.qr-dialog > text,
.qr-dialog > .small {
  display: block;
}
.qr-dialog > text {
  font-size: 34rpx;
  font-weight: 850;
}
.qr-dialog > image {
  width: 420rpx;
  height: 420rpx;
  margin: 24rpx auto;
}
.qr-dialog > .small {
  color: var(--muted);
  margin-bottom: 24rpx;
}
.qr-dialog .outline-btn {
  margin-top: 14rpx;
}
@media (min-width: 900px) {
  .checkout-layout {
    grid-template-columns: 1fr 390px;
    gap: 28px;
    align-items: start;
  }
  .settle {
    position: sticky;
    top: 108px;
  }
  .goods-item {
    grid-template-columns: 120px 1fr;
  }
  .goods-item image {
    width: 120px;
    height: 120px;
  }
}
</style>
