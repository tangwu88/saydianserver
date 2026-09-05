<template>
  <view class="page">
    <view class="container">
      <view v-if="gift" class="gift-card card">
        <view class="gift-icon">券</view>
        <text class="from">{{ gift.employee.name }} 为您送出</text>
        <b>{{ gift.coupon.name }}</b>
        <text class="value">{{ money(gift.coupon.value) }}</text>
        <text class="small">满 {{ money(gift.coupon.minimumSpendCents) }} 可用</text>
        <text class="small">有效期至 {{ date(gift.expiresAt) }}</text>
        <view v-if="gift.status === 'RESERVED'" class="primary-btn" @click="claim">立即领取</view>
        <view v-else class="disabled-btn">该券已领取或已失效</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { ref } from "vue";
import { api, money, toast } from "../../api";

const gift = ref<any>();
const token = ref("");

onLoad(async (options) => {
  token.value = String(options?.token || "");
  try {
    gift.value = await api(`/storefront/coupon-gifts/${encodeURIComponent(token.value)}`);
  } catch (e) {
    toast(e);
  }
});

async function claim() {
  try {
    await api(`/storefront/coupon-gifts/${encodeURIComponent(token.value)}/claim`, {
      method: "POST",
      auth: true,
    });
    uni.showToast({ title: "领取成功" });
    setTimeout(() => uni.redirectTo({ url: "/pages/coupons/index" }), 700);
  } catch (e) {
    toast(e);
  }
}

function date(value: string) {
  return new Date(value).toLocaleString();
}
</script>

<style scoped lang="scss">
.gift-card { margin-top: 80rpx; text-align: center; padding: 54rpx 36rpx; }
.gift-icon { width: 112rpx; height: 112rpx; border-radius: 32rpx; margin: auto; display: flex; align-items: center; justify-content: center; background: linear-gradient(145deg,#ef7d42,#d94b2b); color: #fff; font-size: 52rpx; font-weight: 900; }
.gift-card text,.gift-card b { display: block; }
.from { color: var(--muted); margin: 24rpx 0 12rpx; }
.gift-card b { font-size: 38rpx; }
.value { color: #d95f29; font-size: 68rpx; font-weight: 900; margin: 24rpx 0 8rpx; }
.small { color: var(--muted); margin-top: 10rpx; }
.primary-btn,.disabled-btn { margin-top: 36rpx; }
.disabled-btn { padding: 22rpx; background: #eef1f0; color: #919b98; border-radius: 14rpx; }
</style>
