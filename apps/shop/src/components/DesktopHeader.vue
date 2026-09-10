<template><view class="desktop-header"><view class="head-inner">
  <button class="brand" aria-label="赛电商城首页" @click="go('/pages/home/index')"><image class="brand-logo" :src="brandLogo" mode="aspectFit" /></button>
  <view class="head-links category-links"><button @click="go('/pages/home/index')">首页</button><button @click="go('/pages/category/index')">产品中心</button><button @click="go('/pages/help/index')">帮助与服务</button></view>
  <button class="desktop-search" @click="go('/pages/search/index')">搜索商品</button>
  <view class="head-links"><button @click="go('/pages/profile/index')">我的账户</button><button v-if="!isGlobalMall" @click="go('/pages/cart/index')">购物车</button></view>
</view></view><view v-if="isGlobalMall" class="global-notice">{{ globalCommerceNotice }}</view></template>
<script setup lang="ts">
import { brandLogo } from "../storefront";
import { isGlobalMall, globalCommerceNotice } from "../realm";
function go(url: string) { if (/^\/pages\/(home|category|cart|profile)\/index$/.test(url)) uni.switchTab({ url }); else uni.navigateTo({ url }); }
</script>
<style scoped>.global-notice{font-size:13px;line-height:1.6;padding:10px 18px;background:#eaf2fc;color:#315477;overflow-wrap:anywhere}.brand,.head-links button { background:transparent;margin:0;padding:0;color:inherit;line-height:44px;font-size:16px;border-radius:0; }.brand::after,.head-links button::after {border:0}.head-links button:hover {color:var(--green)}.desktop-search {margin:0;justify-content:flex-start;font-size:14px;}@media(max-width:1100px){.category-links {display:none}}</style>
