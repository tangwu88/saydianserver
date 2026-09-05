<template>
  <view class="store-footer">
    <view class="footer-inner">
      <view>
        <text class="footer-brand">SAYDIAN 赛电</text>
        <text class="footer-copy">© 2026 SAYDIAN 赛电商城 版权所有</text>
      </view>
      <view class="footer-links">
        <text @click="open('/pages/help/index')">帮助中心</text>
        <text @click="open('/pages/help/index?section=service')">售后服务</text>
        <text @click="open('/pages/help/index?section=privacy')">隐私政策</text>
        <text @click="open('/pages/help/index?section=terms')">用户协议</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
function open(url: string) {
  uni.navigateTo({ url });
}
</script>

<style scoped lang="scss">
.store-footer {
  margin-top: 44rpx;
  padding: 36rpx 28rpx calc(130rpx + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: #fff;
}
.footer-inner {
  max-width: 1360px;
  margin: 0 auto;
}
.footer-brand,
.footer-copy {
  display: block;
}
.footer-brand {
  color: var(--ink);
  font-size: 27rpx;
  font-weight: 850;
}
.footer-copy {
  margin-top: 12rpx;
  color: var(--muted);
  font-size: 21rpx;
}
.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 22rpx 30rpx;
  margin-top: 26rpx;
  color: #66736f;
  font-size: 22rpx;
}
@media (min-width: 900px) {
  .store-footer {
    margin-top: 64px;
    padding: 34px 36px;
  }
  .footer-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .footer-brand {
    font-size: 16px;
  }
  .footer-copy {
    margin-top: 8px;
    font-size: 12px;
  }
  .footer-links {
    margin-top: 0;
    gap: 28px;
    font-size: 13px;
  }
}
</style>
