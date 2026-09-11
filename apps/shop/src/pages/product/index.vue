<template>
  <DesktopHeader /><view v-if="shareGuide" class="share-guide" role="dialog" aria-label="微信分享引导" @click="shareGuide=false"><view class="share-guide-card" @click.stop><text class="share-arrow">↗</text><b>点击右上角 ··· 分享商品</b><text>可发送给朋友，或分享到朋友圈</text><button class="primary-btn" @click="copyShareLink">复制商品链接</button><button class="text-button" @click="shareGuide=false">我知道了</button></view></view><view v-if="recovery" class="container recovery-entry"><text>上次下单结果待确认</text><button class="outline-btn" :disabled="busy" @click="restoreCheckout">恢复上次下单</button></view><view v-if="product" class="page"
    ><view class="container product-shortcuts"><button @click="goHome">商城首页</button><button aria-label="分享商品" @click="shareProduct">分享商品</button><button @click="goCart">购物车</button></view
    ><view class="container product-layout"
      ><view class="gallery"
        ><image
          v-if="currentImage"
          class="main-image"
          :src="currentImage"
          mode="aspectFit" /><view v-else class="main-image missing-image">暂无商品图片</view><scroll-view v-if="images.length > 1" scroll-x class="thumbs"
          ><image
            v-for="image in images"
            :key="image"
            :class="currentImage === image && 'active'"
            :src="image"
            mode="aspectFill"
            @click="currentImage = image" /></scroll-view></view
      ><view class="product-info card"
        ><view class="tags"
          ><text v-for="tag in product.tags" :key="tag">{{ tag }}</text></view
        ><text class="title">{{ product.displayName || product.name }}</text
        ><text class="subtitle">{{
          product.subtitle || ""
        }}</text
        ><view class="price-box"
          ><text>{{ money(selectedSku?.salePriceCents) }}</text
          ><del v-if="selectedSku?.marketPriceCents">{{
            money(selectedSku.marketPriceCents)
          }}</del></view
        ><view class="sku-title">选择规格</view
        ><view class="skus"
          ><view
            v-for="sku in product.skus"
            :key="sku.id"
            :class="selectedSku?.id === sku.id && 'active'"
            @click="selectSku(sku)"
            >{{ sku.specification || "默认规格" }}</view
          ></view
        ><view class="stock">库存 {{ selectedSku?.stock ?? '未获取' }} 件</view
        ><view class="quantity"
          ><text>数量</text
          ><view
            ><button aria-label="减少数量" :disabled="busy || quantity <= 1" @click="quantity = Math.max(1, quantity - 1)">−</button
            ><b>{{ quantity }}</b
            ><button aria-label="增加数量" :disabled="busy || !canPurchase || quantity >= selectedSku.stock" @click="quantity = Math.min(selectedSku?.stock || 1, quantity + 1)">＋</button></view
          ></view
        ><view class="actions"
          ><button class="outline-btn" :disabled="busy" @click="toggleFavorite">{{
            product.favorite ? "已收藏" : "收藏"
          }}</button
          ><button class="outline-btn" :disabled="busy || !canPurchase" @click="addCart">加入购物车</button
          ><button class="primary-btn" :disabled="busy || !canPurchase" @click="buyNow">{{ canPurchase ? '立即购买' : '暂时缺货' }}</button></view
        ><button class="text-button" @click="help">帮助与售后</button
        ></view
      ></view
    ><view class="container detail card"
      ><view class="section-title">商品详情</view
      ><rich-text v-if="product.detailHtml" :nodes="product.detailHtml" /><view
        v-else
        class="empty"
        >暂无更多商品详情</view
      ><view v-if="product.reviews?.length"
        ><view class="section-title">用户评价</view
        ><view v-for="review in product.reviews" :key="review.id" class="review"
          ><b>{{ review.user.nickname }}</b
          ><text
            >{{ "★".repeat(review.rating)
            }}{{ "☆".repeat(5 - review.rating) }}</text
          ><text class="small">{{ review.content }}</text></view
        ></view
      ></view
    ></view
  ><view v-else class="empty">{{ error || '正在加载商品…' }}<button v-if="error" @click="load">重新加载</button></view>
</template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
defineOptions({ inheritAttrs: false });
import { onLoad, onShow } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money, toast, requireLogin, clearCheckoutState, mallSessionStamp } from "../../api";
import { isLoggedIn } from "../../session";
const id = ref(''), error = ref(''), busy = ref(false), shareGuide = ref(false);
const recovery = ref<{ userId: string; key: string; session: string } | null>(null);
const product = ref<any>(),
  selectedSku = ref<any>(),
  quantity = ref(1),
  currentImage = ref("");
const canPurchase = computed(() => Number.isSafeInteger(selectedSku.value?.stock) && selectedSku.value.stock >= quantity.value && selectedSku.value.enabled !== false);
const images = computed(() => [
  ...new Set(
    [
      product.value?.coverImage,
      ...(product.value?.gallery || []),
      ...(product.value?.skus || []).map((x: any) => x.image),
    ].filter(Boolean),
  ),
]);
onLoad(o => { id.value = String(o?.id || ''); });
onShow(load);
function goHome(){uni.switchTab({url:'/pages/home/index'});}
function goCart(){uni.switchTab({url:'/pages/cart/index'});}
function help(){uni.navigateTo({url:'/pages/help/index?section=service'});}
function productShareUrl() {
  const route = `#/pages/product/index?id=${encodeURIComponent(id.value)}`;
  return typeof location === 'undefined' ? route : `${location.origin}${location.pathname}${route}`;
}
function copyShareLink() {
  shareGuide.value = false;
  uni.setClipboardData({
    data: productShareUrl(),
    success: () => uni.showToast({ title: '商品链接已复制', icon: 'none' }),
  });
}
async function shareProduct() {
  if (!product.value) return;
  if (typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent)) {
    shareGuide.value = true;
    return;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: product.value.displayName || product.value.name || '赛电商品',
        text: product.value.subtitle || '来自赛电商城的商品',
        url: productShareUrl(),
      });
      return;
    } catch (cause) {
      if ((cause as { name?: string })?.name === 'AbortError') return;
    }
  }
  copyShareLink();
}
async function load() {
  rememberRecovery();
  try {
    error.value = '';
    const selectedId = selectedSku.value?.id;
    product.value = await api(`/storefront/products/${encodeURIComponent(id.value)}`);
    selectedSku.value = product.value.skus?.find((x:any)=>x.id === selectedId) || product.value.skus?.[0];
    quantity.value = Math.max(1, Math.min(quantity.value, selectedSku.value?.stock || 1));
    currentImage.value = images.value[0] || "";
    product.value.favorite = false;
    if (isLoggedIn() && !mallStorage.get('saidian-user')?.phoneTestMode) {
      try { const favorites:any = await api('/storefront/favorites', {auth:true}); product.value.favorite = favorites.some((x:any)=>(x.productId || x.product?.id || x.id) === id.value); }
      catch (cause) { toast(cause); }
    }
  } catch (e) {
    product.value = null;
    error.value = e instanceof Error ? e.message : String(e);
  }
}
function rememberRecovery() {
  const user = mallStorage.get('saidian-user'), draft = mallStorage.get('checkout-draft');
  recovery.value = isLoggedIn() && user?.id && mallStorage.get('checkout-owner') === user.id && draft?.userId === user.id && draft.uncertain === true && typeof draft.key === 'string' && draft.key.length >= 8 && draft.payload && typeof draft.payload === 'object'
    ? { userId: user.id, key: draft.key, session: mallSessionStamp() } : null;
}
function restoreCheckout() {
  if (busy.value) return;
  const saved = recovery.value, user = mallStorage.get('saidian-user'), draft = mallStorage.get('checkout-draft');
  if (!saved || !isLoggedIn() || mallSessionStamp() !== saved.session || user?.id !== saved.userId || mallStorage.get('checkout-owner') !== saved.userId || draft?.userId !== saved.userId || draft.key !== saved.key || draft.uncertain !== true) {
    recovery.value = null; toast('账号或下单状态已变化，请重新打开商品页核对'); return;
  }
  uni.navigateTo({ url: '/pages/checkout/index' });
}
function selectSku(sku: any) {
  selectedSku.value = sku;
  quantity.value = Math.max(1, Math.min(quantity.value, sku.stock || 1));
  if (sku.image) currentImage.value = sku.image;
}
function ensure(checkStock = true) {
  if (!isLoggedIn()) {
    requireLogin('/pages/product/index?id=' + encodeURIComponent(id.value));
    return false;
  }
  if (checkStock && !canPurchase.value) {
    uni.showToast({ title: "库存不足", icon: "none" });
    return false;
  }
  return true;
}
async function addCart() {
  if (!ensure() || busy.value) return;
  busy.value = true;
  try {
    await api("/storefront/cart/items", {
      method: "POST",
      auth: true,
      data: { skuId: selectedSku.value.id, quantity: quantity.value, mode: 'increment' },
    });
    uni.showToast({ title: "已加入购物车" });
  } catch (e) {
    toast(e);
  } finally {
    busy.value = false;
  }
}
function buyNow() {
  if (mallStorage.get('checkout-draft')?.uncertain) { if (!recovery.value) rememberRecovery(); restoreCheckout(); return; }
  if (!ensure()) return;
  clearCheckoutState();
  mallStorage.set('checkout-owner', mallStorage.get('saidian-user')?.id);
  mallStorage.set("checkout-items", [
    {
      skuId: selectedSku.value.id,
      quantity: quantity.value,
      sku: selectedSku.value,
      product: product.value,
    },
  ]);
  uni.navigateTo({ url: "/pages/checkout/index" });
}
async function toggleFavorite() {
  if (!ensure(false) || busy.value) return;
  busy.value = true;
  try {
    const enabled = !product.value.favorite;
    await api(`/storefront/favorites/${product.value.id}`, {
      method: "POST",
      auth: true,
      data: { enabled },
    });
    product.value.favorite = enabled;
  } catch (e) {
    toast(e);
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped lang="scss">
.recovery-entry{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:12px;background:#fff6de;border-radius:12px;font-size:14px}.recovery-entry button{width:auto;min-height:44px;margin:0;padding:8px 12px;line-height:1.5;font-size:14px;flex:none}
.share-guide{position:fixed;inset:0;z-index:1200;background:rgba(13,24,34,.72);display:flex;align-items:flex-start;justify-content:flex-end;padding:20px 24px}.share-guide-card{position:relative;width:min(330px,calc(100vw - 48px));padding:70px 22px 20px;background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.24);display:grid;gap:12px;text-align:center}.share-guide-card>b{font-size:18px}.share-guide-card>text:not(.share-arrow){font-size:14px;color:var(--muted)}.share-guide-card button{margin:0}.share-arrow{position:absolute;right:18px;top:4px;color:var(--green);font-size:54px;line-height:1}
.product-shortcuts {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px;}
.product-shortcuts button {margin:0;padding:0 16px;min-height:44px;line-height:44px;font-size:14px;background:#fff;color:var(--green);}
.actions button{width:100%;min-width:0;min-height:48px;font-size:14px;line-height:1.5;padding:12px 4px;margin:0;white-space:nowrap;}.actions button[disabled]{opacity:.55;}.quantity button{width:44px;min-height:44px;margin:0;padding:0;background:#fff;font-size:20px;line-height:44px;}.quantity button::after{border:0;}
.missing-image {display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:14px;}
.product-layout {
  display: grid;
  gap: 24rpx;
}
.gallery,
.product-info,
.detail {
  min-width: 0;
}
.main-image {
  width: 100%;
  height: 720rpx;
  background: #fff;
  border-radius: 24rpx;
}
.thumbs {
  white-space: nowrap;
  margin-top: 16rpx;
}
.thumbs image {
  width: 110rpx;
  height: 110rpx;
  border-radius: 14rpx;
  margin-right: 14rpx;
  border: 4rpx solid transparent;
}
.thumbs image.active {
  border-color: var(--green);
}
.tags {
  display: flex;
  gap: 10rpx;
}
.tags text {
  font-size: 21rpx;
  padding: 6rpx 12rpx;
  color: var(--green);
  background: var(--mint);
  border-radius: 8rpx;
}
.title {
  display: block;
  font-size: 42rpx;
  font-weight: 900;
  line-height: 1.35;
  margin-top: 22rpx;
}
.subtitle {
  display: block;
  color: var(--muted);
  font-size: 25rpx;
  line-height: 1.6;
  margin-top: 12rpx;
}
.price-box {
  margin: 28rpx -28rpx;
  padding: 22rpx 28rpx;
  background: #fff4f5;
}
.price-box text {
  font-size: 48rpx;
  color: #be092d;
  font-weight: 900;
}
.price-box del {
  font-size: 24rpx;
  color: #9aa4a1;
  margin-left: 18rpx;
}
.sku-title {
  font-weight: 750;
}
.skus {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin: 18rpx 0;
}
.skus view {
  padding: 16rpx 22rpx;
  border: 1px solid #d8e1df;
  border-radius: 12rpx;
  font-size: 24rpx;
}
.skus .active {
  color: var(--green);
  background: var(--mint);
  border-color: var(--green);
}
.stock {
  color: var(--muted);
  font-size: 22rpx;
}
.quantity {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 28rpx 0;
}
.quantity view {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 12rpx;
  overflow: hidden;
}
.quantity view > * {
  width: 70rpx;
  height: 62rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.quantity b {
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
}
.actions {
  display: grid;
  grid-template-columns: 0.7fr 1fr 1.3fr;
  gap: 14rpx;
}
.service-line {
  text-align: center;
  color: var(--muted);
  font-size: 22rpx;
  margin-top: 26rpx;
}
.detail {
  margin-top: 28rpx;
}
.review {
  padding: 22rpx 0;
  border-top: 1px solid var(--line);
}
.review > text {
  float: right;
  color: #e18a38;
}
.review .small {
  display: block;
  margin-top: 12rpx;
  color: #52615d;
}
@media (min-width: 900px) {
  .product-layout {
    grid-template-columns: 1.05fr 0.95fr;
    gap: 34px;
  }
  .main-image {
    height: 620px;
  }
  .product-info {
    padding: 36px;
  }
  .title {
    font-size: 32px;
  }
  .price-box {
    margin: 24px -36px;
    padding: 20px 36px;
  }
  .price-box text {
    font-size: 36px;
  }
  .detail {
    margin-top: 34px;
  }
  .actions {
    margin-top: 30px;
  }
}
</style>
