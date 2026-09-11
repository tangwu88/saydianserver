<template>
  <DesktopHeader /><view v-if="posterVisible" class="poster-overlay" role="dialog" aria-modal="true" aria-label="商品分享海报" @click="closePoster"><view class="poster-card" @click.stop><view class="poster-heading"><b>分享商品</b><button aria-label="关闭分享海报" @click="closePoster"><UniIcons type="closeempty" color="currentColor" size="22" /></button></view><view v-if="posterBusy" class="poster-loading">正在生成分享海报…</view><image v-else-if="posterUrl" class="share-poster" :src="posterUrl" mode="widthFix"/><view v-else class="error-state">{{ posterError || '海报暂时无法生成' }}</view><text class="poster-tip">长按海报可保存，发送给好友后可扫码打开商品。</text><view class="poster-actions"><button class="outline-btn" :disabled="posterBusy || !posterUrl" @click="previewPoster"><UniIcons type="image-filled" color="currentColor" size="18" />查看并保存</button><button class="primary-btn" :disabled="posterBusy" @click="copyShareLink"><UniIcons type="link" color="currentColor" size="18" />复制商品链接</button></view></view></view><view v-if="recovery" class="container recovery-entry"><text>上次下单结果待确认</text><button class="outline-btn" :disabled="busy" @click="restoreCheckout">恢复上次下单</button></view><view v-if="product" class="page"
    ><view class="container product-shortcuts"><button @click="goHome"><UniIcons type="home-filled" color="currentColor" size="18" />商城首页</button><button aria-label="分享商品" :disabled="posterBusy" @click="shareProduct"><UniIcons type="redo-filled" color="currentColor" size="18" />分享商品</button><button @click="goCart"><UniIcons type="cart-filled" color="currentColor" size="18" />购物车</button></view
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
          ><button class="outline-btn" :disabled="busy" @click="toggleFavorite"><UniIcons :type="product.favorite ? 'heart-filled' : 'heart'" color="currentColor" size="18" />{{
            product.favorite ? "已收藏" : "收藏"
          }}</button
          ><button class="outline-btn" :disabled="busy || !canPurchase" @click="addCart"><UniIcons type="cart" color="currentColor" size="18" />加入购物车</button
          ><button class="primary-btn" :disabled="busy || !canPurchase" @click="buyNow"><UniIcons type="wallet-filled" color="currentColor" size="18" />{{ canPurchase ? '立即购买' : '暂时缺货' }}</button></view
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
import QRCode from "qrcode";
import UniIcons from "@dcloudio/uni-ui/lib/uni-icons/uni-icons.vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money, toast, requireLogin, clearCheckoutState, mallSessionStamp } from "../../api";
import { isLoggedIn } from "../../session";
const id = ref(''), error = ref(''), busy = ref(false), posterVisible = ref(false), posterBusy = ref(false), posterUrl = ref(''), posterError = ref('');
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
function productShareUrl() {
  const route = `#/pages/product/index?id=${encodeURIComponent(id.value)}`;
  if (typeof location === 'undefined') return route;
  const referral = String(mallStorage.get('saidian-ref') || '').trim();
  return `${location.origin}${location.pathname}${referral ? `?ref=${encodeURIComponent(referral)}` : ''}${route}`;
}
function copyShareLink() {
  uni.setClipboardData({
    data: productShareUrl(),
    success: () => uni.showToast({ title: '商品链接已复制', icon: 'none' }),
  });
}
async function shareProduct() {
  if (!product.value) return;
  posterVisible.value = true;
  if (posterUrl.value || posterBusy.value) return;
  posterBusy.value = true; posterError.value = '';
  try { posterUrl.value = await buildSharePoster(); }
  catch { posterError.value = '海报生成失败，可先复制商品链接分享'; }
  finally { posterBusy.value = false; }
}
function closePoster(){posterVisible.value=false;}
function previewPoster(){if(posterUrl.value)uni.previewImage({current:posterUrl.value,urls:[posterUrl.value]});}
async function buildSharePoster():Promise<string>{
  if(typeof document==='undefined')return QRCode.toDataURL(productShareUrl(),{width:720,margin:3,color:{dark:'#111827',light:'#ffffff'}});
  const canvas=document.createElement('canvas');canvas.width=750;canvas.height=1080;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas unavailable');
  ctx.fillStyle='#f3f5f8';ctx.fillRect(0,0,750,1080);ctx.fillStyle='#ffffff';roundRect(ctx,35,35,680,1010,32);ctx.fill();
  ctx.fillStyle='#d20b27';ctx.font='700 34px sans-serif';ctx.fillText('SAYDIAN 赛电',72,98);ctx.fillStyle='#111827';ctx.font='700 42px sans-serif';drawWrappedText(ctx,String(product.value.displayName||product.value.name||'赛电商品'),72,158,606,56,2);
  const productImage=await loadPosterImage(currentImage.value);if(productImage)drawContain(ctx,productImage,72,270,606,470);else{ctx.fillStyle='#f6f7f9';ctx.fillRect(72,270,606,470);ctx.fillStyle='#98a2b3';ctx.font='26px sans-serif';ctx.fillText('商品图片',320,510);}
  ctx.fillStyle='#be092d';ctx.font='800 48px sans-serif';ctx.fillText(money(selectedSku.value?.salePriceCents),72,820);
  ctx.fillStyle='#4b5563';ctx.font='24px sans-serif';ctx.fillText('扫码查看商品详情',72,888);
  const qr=await loadPosterImage(await QRCode.toDataURL(productShareUrl(),{width:220,margin:1,color:{dark:'#111827',light:'#ffffff'}}));if(qr)ctx.drawImage(qr,458,810,190,190);
  ctx.fillStyle='#8a94a3';ctx.font='20px sans-serif';ctx.fillText('商品价格与库存以打开页面时为准',72,985);
  return canvas.toDataURL('image/png');
}
function roundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){const radius=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+radius,y);ctx.lineTo(x+w-radius,y);ctx.quadraticCurveTo(x+w,y,x+w,y+radius);ctx.lineTo(x+w,y+h-radius);ctx.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);ctx.lineTo(x+radius,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-radius);ctx.lineTo(x,y+radius);ctx.quadraticCurveTo(x,y,x+radius,y);ctx.closePath();}
function drawWrappedText(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,maxWidth:number,lineHeight:number,maxLines:number){let line='',lineNo=0;for(const char of text){const next=line+char;if(ctx.measureText(next).width>maxWidth&&line){ctx.fillText(line,x,y+lineNo*lineHeight);line=char;if(++lineNo>=maxLines)return;}else line=next;}if(line&&lineNo<maxLines)ctx.fillText(line,x,y+lineNo*lineHeight);}
function loadPosterImage(src:string):Promise<HTMLImageElement|null>{return new Promise(resolve=>{if(!src)return resolve(null);const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=src;});}
function drawContain(ctx:CanvasRenderingContext2D,image:HTMLImageElement,x:number,y:number,w:number,h:number){const scale=Math.min(w/image.naturalWidth,h/image.naturalHeight),dw=image.naturalWidth*scale,dh=image.naturalHeight*scale;ctx.drawImage(image,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
async function load() {
  rememberRecovery();
  try {
    error.value = '';
    const selectedId = selectedSku.value?.id;
    product.value = await api(`/storefront/products/${encodeURIComponent(id.value)}`);
    uni.setNavigationBarTitle({ title: String(product.value.displayName || product.value.name || '商品详情') });
    posterUrl.value = '';
    posterError.value = '';
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
.poster-overlay{position:fixed;inset:0;z-index:1200;background:rgba(13,24,34,.72);display:grid;place-items:center;padding:20px}.poster-card{width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:18px;background:#fff;border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.24)}.poster-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.poster-heading>b{font-size:18px}.poster-heading button{width:40px;min-height:40px;margin:0;padding:0;background:#f4f6f8;color:#374151;line-height:40px}.poster-loading{min-height:240px;display:grid;place-items:center;color:var(--muted)}.share-poster{display:block;width:100%;border-radius:12px;background:#f4f6f8}.poster-tip{display:block;margin:12px 0;color:var(--muted);font-size:13px;line-height:1.6;text-align:center}.poster-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.poster-actions button{margin:0;min-height:46px;font-size:14px}.poster-actions button,.product-shortcuts button,.actions button{display:flex;align-items:center;justify-content:center;gap:7px}
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
