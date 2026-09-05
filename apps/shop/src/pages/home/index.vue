<template>
  <DesktopHeader />
  <view class="mobile-head">
    <image src="https://www.saydian.cn/pic/logo.png" mode="aspectFit" />
    <text @click="goCart">购物车</text>
  </view>
  <view class="page home-page">
    <view class="home-container">
      <view class="mobile-search" @click="goSearch">搜索赛电智能穿戴产品</view>

      <view class="hero">
        <view class="hero-copy">
          <text class="hero-eyebrow">SAYDIAN · {{ heroProduct?.name || "智能健康穿戴" }}</text>
          <text class="hero-title">小巧有力，轻松守护</text>
          <text class="hero-sub">选择适合自己的智能戒指、手表与手环</text>
          <text v-if="heroProduct" class="hero-price">{{ money(heroProduct.priceCents) }}</text>
          <view class="hero-actions">
            <view class="hero-primary" @click="heroProduct ? buyNow(heroProduct) : goCategory()">
              {{ heroProduct ? "立即购买" : "浏览商品" }}
            </view>
            <view class="hero-secondary" @click="goCategory">了解更多</view>
          </view>
        </view>
        <view class="hero-media">
          <image :src="heroProduct?.coverImage || ringImage" mode="aspectFit" />
        </view>
      </view>

      <view v-if="state.referral" class="referral-line">
        由赛电员工 {{ state.referral.name }} 为您提供专属服务
      </view>

      <view v-if="state.categories?.length" class="category-strip">
        <view
          v-for="(category, index) in state.categories.slice(0, 4)"
          :key="category.id"
          class="category-shortcut"
          @click="openCategory(category.id)"
        >
          <image
            :src="state.featured[index]?.coverImage || category.iconUrl || ringImage"
            mode="aspectFit"
          />
          <view>
            <text class="category-name">{{ category.name }}</text>
            <text class="category-link">选购产品 ›</text>
          </view>
        </view>
      </view>

      <view class="products-layout">
        <view class="products-main">
          <view class="section-title">
            <text>人气推荐</text>
            <text class="small" @click="goCategory">查看全部 ›</text>
          </view>
          <view v-if="state.featured?.length" class="product-grid">
            <ProductCard
              v-for="product in state.featured.slice(0, 8)"
              :key="product.id"
              :product="product"
              @open="openProduct"
              @buy="buyNow"
            />
          </view>
          <view v-else class="catalog-empty">
            <text>商品正在上架</text>
            <view class="hero-primary" @click="goCategory">查看全部商品</view>
          </view>
        </view>

        <view class="cart-summary">
          <view class="cart-title">
            <text>我的购物车</text>
            <text class="small" @click="goCart">查看全部 ›</text>
          </view>
          <template v-if="state.cart?.items?.length">
            <view v-for="item in state.cart.items.slice(0, 3)" :key="item.id" class="cart-item">
              <image :src="item.sku.image || item.sku.product.coverImage || ringImage" mode="aspectFit" />
              <view>
                <text>{{ item.sku.product.displayName || item.sku.product.name }}</text>
                <text class="small">{{ money(item.sku.salePriceCents) }} × {{ item.quantity }}</text>
              </view>
            </view>
            <view class="cart-total">
              <text>小计</text>
              <text>{{ money(cartTotal) }}</text>
            </view>
            <view class="checkout-btn" @click="goCart">去结算</view>
          </template>
          <template v-else>
            <text class="cart-empty">{{ hasToken ? "购物车还是空的" : "登录后查看购物车" }}</text>
            <view class="checkout-btn" @click="hasToken ? goCategory() : goProfile()">
              {{ hasToken ? "去选购" : "去登录" }}
            </view>
          </template>
        </view>
      </view>
    </view>
  </view>
  <StoreFooter />
</template>

<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { computed, reactive } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import ProductCard from "../../components/ProductCard.vue";
import StoreFooter from "../../components/StoreFooter.vue";
import { api, money, toast } from "../../api";
import { captureReferral } from "../../session";

const ringImage = "https://www.saydian.cn/pic/1.png";
const state = reactive<any>({
  featured: [],
  banners: [],
  categories: [],
  referral: null,
  cart: null,
});
const hasToken = computed(() => Boolean(uni.getStorageSync("saidian-token")));
const heroProduct = computed(() => state.featured?.[0]);
const cartTotal = computed(() =>
  (state.cart?.items || []).reduce(
    (total: number, item: any) =>
      total + Number(item.sku.salePriceCents || 0) * Number(item.quantity || 0),
    0,
  ),
);

onShow(async () => {
  if (
    typeof navigator !== "undefined" &&
    /wxwork/i.test(navigator.userAgent) &&
    !uni.getStorageSync("employee-token")
  ) {
    uni.navigateTo({ url: "/pages/employee/index" });
    return;
  }
  captureReferral();
  try {
    const boot: any = await api(
      `/storefront/bootstrap?ref=${encodeURIComponent(String(uni.getStorageSync("saidian-ref") || ""))}`,
    );
    Object.assign(state, boot);
    if (!state.featured?.length) {
      const catalog: any = await api("/storefront/products?page=1&pageSize=8");
      state.featured = catalog.items;
    }
    if (hasToken.value) state.cart = await api("/storefront/cart", { auth: true });
  } catch (error) {
    toast(error);
  }
});

function openProduct(id: string) {
  uni.navigateTo({ url: `/pages/product/index?id=${id}` });
}
function buyNow(product: any) {
  if (!product.defaultSku) return openProduct(product.id);
  uni.setStorageSync("checkout-items", [
    {
      skuId: product.defaultSku.id,
      quantity: 1,
      sku: product.defaultSku,
      product: {
        id: product.id,
        name: product.name,
        displayName: product.name,
        coverImage: product.coverImage,
      },
    },
  ]);
  uni.navigateTo({ url: "/pages/checkout/index" });
}
function openCategory(id: string) {
  uni.setStorageSync("saidian-category-selected", id);
  goCategory();
}
function goCategory() {
  uni.switchTab({ url: "/pages/category/index" });
}
function goCart() {
  uni.switchTab({ url: "/pages/cart/index" });
}
function goProfile() {
  uni.switchTab({ url: "/pages/profile/index" });
}
function goSearch() {
  uni.navigateTo({ url: "/pages/search/index" });
}
</script>

<style scoped lang="scss">
.mobile-head {
  height: 112rpx;
  padding: 0 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--deep);
  color: #fff;
}
.mobile-head image {
  width: 250rpx;
  height: 36rpx;
  filter: brightness(0) invert(1);
}
.mobile-head text {
  font-size: 24rpx;
}
.home-page {
  padding-top: 20rpx;
}
.home-container {
  max-width: 1360px;
  margin: 0 auto;
}
.mobile-search {
  height: 76rpx;
  margin-bottom: 20rpx;
  padding: 0 24rpx;
  border: 1px solid var(--line);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  background: #fff;
  color: #8a98a9;
  font-size: 24rpx;
}
.hero {
  min-height: 600rpx;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 24rpx;
  background: #fff;
}
.hero-copy {
  padding: 44rpx 34rpx 36rpx;
}
.hero-eyebrow,
.hero-title,
.hero-sub,
.hero-price {
  display: block;
}
.hero-eyebrow {
  color: var(--green);
  font-size: 22rpx;
  font-weight: 700;
}
.hero-title {
  margin-top: 18rpx;
  color: var(--ink);
  font-size: 52rpx;
  line-height: 1.18;
  font-weight: 900;
}
.hero-sub {
  margin-top: 18rpx;
  color: var(--muted);
  font-size: 25rpx;
}
.hero-price {
  margin-top: 22rpx;
  color: var(--green);
  font-size: 42rpx;
  font-weight: 900;
}
.hero-actions {
  display: flex;
  gap: 18rpx;
  margin-top: 28rpx;
}
.hero-primary,
.hero-secondary {
  height: 78rpx;
  padding: 0 34rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  font-weight: 750;
}
.hero-primary {
  background: var(--green);
  color: #fff;
}
.hero-secondary {
  border: 1px solid var(--line);
  color: var(--ink);
  background: #fff;
}
.hero-media {
  height: 390rpx;
  background: var(--deep);
}
.hero-media image {
  width: 100%;
  height: 100%;
}
.referral-line {
  margin-top: 18rpx;
  padding: 18rpx 24rpx;
  border-radius: 12rpx;
  background: #eef6ff;
  color: #285b8d;
  font-size: 23rpx;
}
.category-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}
.category-shortcut {
  min-height: 154rpx;
  padding: 18rpx;
  display: flex;
  align-items: center;
  gap: 18rpx;
  border: 1px solid var(--line);
  border-radius: 18rpx;
  background: #fff;
}
.category-shortcut image {
  width: 88rpx;
  height: 88rpx;
  flex: none;
}
.category-name,
.category-link {
  display: block;
}
.category-name {
  font-size: 25rpx;
  color: var(--ink);
  font-weight: 800;
}
.category-link {
  margin-top: 10rpx;
  color: var(--green);
  font-size: 21rpx;
}
.products-layout {
  display: grid;
}
.catalog-empty {
  min-height: 260rpx;
  padding: 42rpx;
  border: 1px solid var(--line);
  border-radius: 18rpx;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26rpx;
  color: var(--muted);
}
.cart-summary {
  display: none;
}

@media (min-width: 900px) {
  .mobile-head,
  .mobile-search {
    display: none;
  }
  .home-page {
    padding-top: 20px;
  }
  .hero {
    min-height: 330px;
    display: grid;
    grid-template-columns: 1fr 1.08fr;
    border-radius: 24px;
  }
  .hero-copy {
    padding: 34px 38px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .hero-eyebrow {
    font-size: 14px;
  }
  .hero-title {
    margin-top: 15px;
    font-size: 42px;
  }
  .hero-sub {
    margin-top: 14px;
    font-size: 15px;
  }
  .hero-price {
    margin-top: 20px;
    font-size: 30px;
  }
  .hero-actions {
    margin-top: 20px;
    gap: 12px;
  }
  .hero-primary,
  .hero-secondary {
    height: 44px;
    padding: 0 28px;
    border-radius: 8px;
    font-size: 14px;
  }
  .hero-media {
    height: auto;
    min-height: 330px;
  }
  .category-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px;
    margin-top: 20px;
  }
  .category-shortcut {
    min-height: 112px;
    padding: 18px 22px;
    gap: 18px;
    border-radius: 14px;
  }
  .category-shortcut image {
    width: 70px;
    height: 70px;
  }
  .category-name {
    font-size: 15px;
  }
  .category-link {
    margin-top: 8px;
    font-size: 12px;
  }
  .products-layout {
    grid-template-columns: minmax(0, 1fr) 270px;
    align-items: start;
    gap: 22px;
  }
  .products-main .product-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }
  .cart-summary {
    display: block;
    margin-top: 82px;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: #fff;
    position: sticky;
    top: 98px;
  }
  .cart-title,
  .cart-total {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cart-title {
    margin-bottom: 12px;
    font-weight: 800;
  }
  .cart-title .small {
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
  }
  .cart-item {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 10px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }
  .cart-item image {
    width: 56px;
    height: 56px;
  }
  .cart-item text {
    display: block;
    font-size: 13px;
  }
  .cart-item .small {
    margin-top: 8px;
    color: var(--green);
    font-size: 12px;
  }
  .cart-total {
    padding-top: 16px;
    border-top: 1px solid var(--line);
    color: var(--ink);
    font-weight: 850;
  }
  .cart-total text:last-child {
    color: var(--green);
    font-size: 20px;
  }
  .checkout-btn {
    height: 44px;
    margin-top: 16px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--green);
    color: #fff;
    font-size: 14px;
    font-weight: 750;
  }
  .cart-empty {
    display: block;
    padding: 30px 0 14px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }
}
</style>
