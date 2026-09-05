<template>
  <view class="page"
    ><view class="container"
      ><view
        v-for="item in coupons"
        :key="item.id"
        :class="['coupon', item.usedAt && 'used']"
        ><view
          ><b>{{ money(item.coupon.value) }}</b
          ><text class="small"
            >满 {{ money(item.coupon.minimumSpendCents) }} 可用</text
          ></view
        ><view
          ><text>{{ item.coupon.name }}</text
          ><text class="small"
            >{{ date(item.coupon.validFrom) }} -
            {{ date(item.coupon.validUntil) }}</text
          ><em>{{ item.usedAt ? "已使用" : "可使用" }}</em></view
        ></view
      ><view v-if="!coupons.length" class="empty card">暂无优惠券</view></view
    ></view
  >
</template>
<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import { api, money, toast } from "../../api";
const coupons = ref<any[]>([]);
onShow(async () => {
  try {
    coupons.value = await api("/storefront/coupons", { auth: true });
  } catch (e) {
    toast(e);
  }
});
function date(v: string) {
  return new Date(v).toLocaleDateString();
}
</script>
<style scoped lang="scss">
.coupon {
  display: grid;
  grid-template-columns: 210rpx 1fr;
  margin-bottom: 18rpx;
  background: #fff;
  border-radius: 22rpx;
  overflow: hidden;
}
.coupon > view {
  padding: 28rpx;
}
.coupon > view:first-child {
  background: linear-gradient(135deg, #1c7968, #135246);
  color: #fff;
  text-align: center;
}
.coupon b,
.coupon .small,
.coupon text,
.coupon em {
  display: block;
}
.coupon b {
  font-size: 42rpx;
}
.coupon .small {
  margin-top: 10rpx;
  font-size: 20rpx;
}
.coupon > view:nth-child(2) {
  position: relative;
}
.coupon text {
  font-weight: 850;
  font-size: 29rpx;
}
.coupon > view:nth-child(2) .small {
  color: var(--muted);
}
.coupon em {
  position: absolute;
  right: 22rpx;
  bottom: 22rpx;
  color: var(--green);
  font-style: normal;
}
.coupon.used {
  opacity: 0.55;
}
</style>
