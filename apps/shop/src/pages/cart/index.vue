<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><view class="section-title"
        ><text>购物车</text
        ><text class="small">{{ selected.length }} 件已选</text></view
      ><view v-if="cart.items?.length" class="cart-layout"
        ><view class="cart-list"
          ><view
            v-for="item in cart.items"
            :key="item.id"
            class="cart-item card"
            ><view
              :class="['check', item.selected && 'active']"
              @click="update(item, item.quantity, !item.selected)"
              >✓</view
            ><image
              :src="
                item.sku.image ||
                item.sku.product.coverImage ||
                productPlaceholder
              "
              mode="aspectFit"
            /><view class="cart-info"
              ><text class="name">{{
                item.sku.product.displayName || item.sku.product.name
              }}</text
              ><text class="small">{{
                item.sku.specification || '默认规格'
              }}</text
              ><text class="price">{{ money(item.sku.salePriceCents) }}</text
              ><view class="cart-bottom"
                ><view class="counter"
                  ><text
                    @click="
                      update(
                        item,
                        Math.max(1, item.quantity - 1),
                        item.selected,
                      )
                    "
                    >−</text
                  ><b>{{ item.quantity }}</b
                  ><text @click="update(item, item.quantity + 1, item.selected)"
                    >＋</text
                  ></view
                ><text class="delete" @click="remove(item.id)">删除</text></view
              ><text v-if="!item.available" class="unavailable"
                >库存不足或商品已下架</text
              ></view
            ></view
          ></view
        ><view class="summary card"
          ><view
            ><text>商品金额</text><b>{{ money(total) }}</b></view
          ><view><text>优惠</text><b>结算页计算</b></view
          ><view class="summary-total"
            ><text>合计</text><b>{{ money(total) }}</b></view
          ><view class="primary-btn" @click="checkout"
            >去结算（{{ selected.length }}）</view
          ></view
        ></view
      ><view v-else class="empty card"
        ><text>购物车还是空的</text
        ><view class="outline-btn" @click="shop">去逛逛</view></view
      ></view
    ></view
  >
  <StoreFooter />
</template>
<script setup lang="ts">
import { mallStorage } from "../../realm";
import { onShow } from "@dcloudio/uni-app";
import { computed, reactive, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import StoreFooter from "../../components/StoreFooter.vue";
import { api, money, productPlaceholder, toast, clearCheckoutState } from "../../api";
const busy = ref(false);
const cart = reactive<any>({ items: [] });
const selected = computed(() =>
  cart.items.filter((x: any) => x.selected && x.available),
);
const total = computed(() =>
  selected.value.reduce(
    (s: number, x: any) => s + x.sku.salePriceCents * x.quantity,
    0,
  ),
);
onShow(load);
async function load() {
  cart.items = [];
  try {
    Object.assign(cart, await api("/storefront/cart", { auth: true }));
  } catch (e) {
    toast(e);
  }
}
async function update(item: any, quantity: number, selected: boolean) {
  if (busy.value) return;
  if (quantity > item.sku.stock) return toast('库存不足，请减少数量');
  busy.value = true;
  try {
    Object.assign(
      cart,
      await api("/storefront/cart/items", {
        method: "POST",
        auth: true,
        data: { skuId: item.skuId, quantity, selected },
      }),
    );
  } catch (e) {
    toast(e);
  } finally {
    busy.value = false;
  }
}
async function remove(id: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    Object.assign(
      cart,
      await api(`/storefront/cart/items/${id}`, {
        method: "DELETE",
        auth: true,
      }),
    );
  } catch (e) {
    toast(e);
  } finally {
    busy.value = false;
  }
}
function checkout() {
  if (busy.value) return;
  if (mallStorage.get('checkout-draft')?.uncertain) { toast('先恢复上次下单结果，不会创建新的结算请求');uni.navigateTo({url:'/pages/checkout/index'});return; }
  if (!selected.value.length) return toast("请选择有库存的商品");
  clearCheckoutState();
  mallStorage.set('checkout-owner', mallStorage.get('saidian-user')?.id);
  mallStorage.set(
    "checkout-items",
    selected.value.map((x: any) => ({
      skuId: x.skuId,
      quantity: x.quantity,
      sku: x.sku,
      product: x.sku.product,
    })),
  );
  uni.navigateTo({ url: "/pages/checkout/index" });
}
function shop() {
  uni.switchTab({ url: "/pages/category/index" });
}
</script>
<style scoped lang="scss">
.cart-layout {
  display: grid;
  gap: 24rpx;
}
.cart-list {
  display: grid;
  gap: 18rpx;
}
.cart-item {
  display: grid;
  grid-template-columns: 44rpx 180rpx 1fr;
  gap: 20rpx;
  align-items: center;
}
.check {
  width: 38rpx;
  height: 38rpx;
  border-radius: 50%;
  border: 2rpx solid #b7c4c0;
  color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
}
.check.active {
  background: var(--green);
  border-color: var(--green);
  color: #fff;
}
.cart-item image {
  width: 180rpx;
  height: 180rpx;
  border-radius: 18rpx;
  background: var(--mint);
}
.cart-info {
  min-width: 0;
}
.name {
  font-weight: 800;
  line-height: 1.4;
  display: block;
}
.cart-info .small {
  display: block;
  color: var(--muted);
  margin: 10rpx 0;
}
.price {
  color: #d95f29;
  font-weight: 850;
}
.cart-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
}
.counter {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 10rpx;
}
.counter > * {
  width: 54rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.delete {
  color: var(--muted);
  font-size: 22rpx;
}
.unavailable {
  display: block;
  color: #d45b31;
  font-size: 20rpx;
  margin-top: 8rpx;
}
.summary > view:not(.primary-btn) {
  display: flex;
  justify-content: space-between;
  margin-bottom: 24rpx;
}
.summary-total {
  border-top: 1px solid var(--line);
  padding-top: 24rpx;
}
.summary-total b {
  color: #d95f29;
  font-size: 34rpx;
}
.empty .outline-btn {
  width: 220rpx;
  margin: 30rpx auto 0;
}
@media (min-width: 900px) {
  .cart-layout {
    grid-template-columns: 1fr 330px;
    align-items: start;
    gap: 28px;
  }
  .summary {
    position: sticky;
    top: 108px;
  }
  .cart-item {
    grid-template-columns: 24px 150px 1fr;
  }
  .cart-item image {
    width: 150px;
    height: 150px;
  }
}
</style>
