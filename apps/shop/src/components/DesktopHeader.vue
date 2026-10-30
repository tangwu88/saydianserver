<template><view class="desktop-header" :class="{'app-header':isGlobalMall}"><view class="head-inner">
  <button class="brand" aria-label="Saydian 首页" @click="go('/pages/home/index')"><BrandIdentity v-if="isGlobalMall"/><image v-else class="brand-logo" :src="brandLogo" mode="aspectFit" /></button>
  <view class="head-links category-links"><button @click="go('/pages/home/index')">首页</button><button @click="go('/pages/category/index')">产品中心</button><button @click="go('/pages/help/index')">帮助与服务</button></view>
  <button class="desktop-search" @click="go('/pages/search/index')">搜索商品</button>
  <view class="head-links"><!-- #ifdef H5 --><AppDownload variant="nav" /><!-- #endif --><button @click="go('/pages/profile/index')">我的账户</button><button @click="go('/pages/cart/index')">购物车</button></view>
</view></view></template>
<script setup lang="ts">
import { brandLogo } from "../storefront";
import { isGlobalMall } from "../realm";
import BrandIdentity from "./BrandIdentity.vue";
// #ifdef H5
import AppDownload from "./AppDownload.vue";
// #endif
function go(url: string) { if (/^\/pages\/(home|category|cart|profile)\/index$/.test(url)) uni.switchTab({ url }); else uni.navigateTo({ url }); }
</script>
<style scoped>.app-header{--green:#245d47;color:#171b2b}.brand,.head-links button { background:transparent;margin:0;padding:0;color:inherit;line-height:44px;font-size:16px;border-radius:0; }.brand::after,.head-links button::after {border:0}.head-links button:hover {color:var(--green)}.desktop-search {margin:0;justify-content:flex-start;font-size:14px;}@media(max-width:1100px){.category-links {display:none}}</style>

<style scoped>.desktop-search{border-radius:999px;background:#edf1e6;color:#5e6b61}.brand{filter:brightness(0)}.head-links button{font-size:14px}</style>
