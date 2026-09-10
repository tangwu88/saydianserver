<template>
  <DesktopHeader />
  <view class="mobile-brand"><image :src="brandLogo" mode="aspectFit" /><text>赛电商城</text><button @click="go('/pages/search/index')">搜索</button></view>
  <view class="page home-page"><view class="container">
    <view v-if="notice" class="store-notice">{{ notice }}</view>
    <view v-if="error" class="error-state"><text>{{ error }}</text><button class="outline-btn" @click="load">重新加载</button></view>
    <swiper v-if="state.banners.length" class="store-banners" indicator-dots autoplay :interval="6000">
      <swiper-item v-for="banner in state.banners" :key="banner.id"><view class="banner" @click="openBanner(banner)">
        <image :src="banner.imageUrl" mode="aspectFit" /><view class="banner-copy"><text class="banner-kicker">SAYDIAN 赛电</text><text class="banner-title">{{ banner.title }}</text><text class="banner-link">查看商品 →</text></view>
      </view></swiper-item>
    </swiper>
    <view v-if="state.referral" class="referral-line">专属服务 · {{ state.referral.name }}</view>
    <view class="catalog-layout">
      <view class="catalog-side"><text class="side-title">产品中心</text><button class="category-link" @click="category()">全部商品 <text>→</text></button><button v-for="item in state.categories" :key="item.id" class="category-link" @click="category(item.id)">{{ item.name }} <text>→</text></button><button class="help-link" @click="go('/pages/help/index')">帮助与售后</button></view>
      <view class="catalog-main"><view class="section-title"><text>精选商品</text><button class="text-button" @click="category()">查看全部 →</button></view>
        <view v-if="loading && !state.featured.length" class="empty">正在加载商品…</view>
        <view v-else-if="!state.featured.length && !error" class="empty">暂无上架商品</view>
        <view class="product-grid"><ProductCard v-for="product in state.featured" :key="product.id" :product="product" @open="openProduct" @buy="product => openProduct(product.id)" /></view>
      </view>
    </view>
  </view></view>
  <StoreFooter />
</template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
import { onShow } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import ProductCard from "../../components/ProductCard.vue";
import StoreFooter from "../../components/StoreFooter.vue";
import { storefront, loadStorefront, configValue, brandLogo } from "../../storefront";
import { captureReferral } from "../../session";
const state = storefront;
const loading = ref(false);
const error = ref("");
const notice = computed(() => { const value = configValue("store.notice"); return typeof value === "string" ? value : value?.text || value?.notice || ""; });
async function load() { loading.value = true; error.value = ""; try { await loadStorefront(); } catch (e) { error.value = e instanceof Error ? e.message : "商城暂时无法加载"; } finally { loading.value = false; } }
onShow(() => { captureReferral(); void load(); });
function go(url: string) { uni.navigateTo({ url }); }
function openProduct(id: string) { go(`/pages/product/index?id=${encodeURIComponent(id)}`); }
function category(id?: string) { mallStorage.set("saidian-category-selected", id || ""); uni.switchTab({ url: "/pages/category/index" }); }
function openBanner(banner: any) {
  if (banner.productId) return openProduct(banner.productId);
  const url = String(banner.targetUrl || banner.linkUrl || banner.link || "");
  if (/^\/pages\/[a-z0-9-]+\/index(?:\?|$)/i.test(url)) {
    if (/^\/pages\/(home|category|cart|profile)\/index/.test(url)) return uni.switchTab({ url: url.split("?")[0]! });
    return go(url);
  }
  category();
}
</script>
<style scoped lang="scss">
.mobile-brand { display:flex; align-items:center; gap:12px; background:#fff; padding:12px 16px; color:var(--ink); }
.mobile-brand image { width:86px; height:34px; }.mobile-brand>text { flex:1; font-size:16px; font-weight:600; }.mobile-brand button { background:#f1f2f4; font-size:14px; line-height:36px; margin:0; }
.home-page { min-height:60vh; padding-top:12px; padding-bottom:20px; }
.store-notice { font-size:14px; line-height:1.6; color:#76531c; background:#fff8e6; border:1px solid #f0dfb9; padding:10px 14px; margin-bottom:16px; }
.store-banners { height:210px; background:#fff; margin-bottom:22px; }
.banner { height:100%; display:flex; flex-direction:row-reverse; background:#fff; align-items:center; padding:12px; }
.banner image { width:48%; height:100%; flex:none; }.banner-copy { flex:1; padding:12px; }.banner-copy text { display:block; }
.banner-kicker { font-size:12px; color:var(--muted); letter-spacing:1px; }.banner-title { font-size:23px; font-weight:700; color:var(--ink); line-height:1.35; margin:12px 0; }.banner-link { font-size:14px; color:var(--green); }
.catalog-side { display:flex; align-items:center; gap:8px; overflow:auto; padding-bottom:6px; }.side-title,.help-link { display:none; }
.category-link { display:flex; align-items:center; justify-content:space-between; gap:14px; white-space:nowrap; border-radius:4px; background:#fff; padding:0 14px; line-height:44px; font-size:14px; margin:0; }.category-link text { color:var(--green); }
.catalog-main { min-width:0; }.section-title { margin:22px 0 16px; font-size:22px; }.referral-line { color:var(--green); font-size:14px; margin:12px 0; }
@media(min-width:900px) { .mobile-brand {display:none;} .home-page {padding-top:24px;}.store-banners {height:280px;margin-bottom:32px;} .banner {padding:20px 60px;} .banner-title {font-size:36px;max-width:500px;} .banner image {width:40%;}.banner-copy {padding:20px;}.catalog-layout {display:grid;grid-template-columns:220px minmax(0,1fr);gap:30px;align-items:start;}.catalog-side {display:block;background:#fff;padding:24px;}.side-title {display:block;font-size:20px;font-weight:700;margin-bottom:12px;}.category-link {width:100%;padding:12px 0;border-radius:0;border-bottom:1px solid var(--line);font-size:16px;}.help-link {display:block;margin:22px 0 0;font-size:14px;background:#f1f2f4;}.section-title {margin:0 0 22px;}.product-grid {grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;} }
</style>
