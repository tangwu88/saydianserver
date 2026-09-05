<template>
  <view class="desktop-header"
    ><view class="head-inner"
      ><view class="brand" @click="go('/')"
        ><image
          class="brand-logo"
          src="https://www.saydian.cn/pic/logo.png"
          mode="aspectFit"
        /></view
      ><view class="head-links category-links"
        ><text class="active" @click="go('/')">首页</text
        ><text @click="goCategory">智能戒指</text
        ><text @click="goCategory">智能手表</text
        ><text @click="goCategory">智能手环</text
        ><text @click="goCategory">配件</text></view
      ><view class="desktop-search" @click="go('/pages/search/index')"
        >搜索智能手表、手环、智能戒指</view
      ><view class="head-links account-links"
        ><text @click="go('/pages/profile/index')">我的账户</text
        ><text @click="go('/pages/cart/index')">购物车</text></view
      ></view
    ></view
  >
</template>
<script setup lang="ts">
function go(url: string) {
  const tabPages: Record<string, string> = {
    "/": "/pages/home/index",
    "/pages/cart/index": "/pages/cart/index",
    "/pages/profile/index": "/pages/profile/index",
  };
  if (tabPages[url]) uni.switchTab({ url: tabPages[url] });
  else uni.navigateTo({ url });
}
function goCategory() {
  uni.switchTab({ url: "/pages/category/index" });
}
</script>
<style scoped lang="scss">
.category-links {
  gap: 30px;
  white-space: nowrap;
}
.category-links text {
  height: 78px;
  display: flex;
  align-items: center;
  border-bottom: 3px solid transparent;
}
.category-links text.active {
  border-color: #1195ff;
}
.account-links {
  white-space: nowrap;
}
@media (max-width: 1180px) {
  .category-links {
    display: none;
  }
}
</style>
