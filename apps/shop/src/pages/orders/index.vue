<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><button class="browse-link" @click="browse">继续逛逛</button><view class="tabs" role="tablist" aria-label="订单状态"
        ><button
          v-for="tab in tabs"
          :key="tab.value"
          :class="status === tab.value && 'active'"
          role="tab"
          :aria-selected="status === tab.value"
          @click="select(tab.value)"
          >{{ tab.label }}</button
        ></view
      ><view v-if="error" class="error-state" role="alert">{{ error }}<button @click="load">重新加载</button></view
      ><view v-if="orders.length" class="orders"
        ><view
          v-for="order in orders"
          :key="order.id"
          class="order card"
          @click="open(order.id)"
          ><view class="row between"
            ><text class="order-no">{{ order.orderNo }}</text
            ><text class="status">{{ label(order.status) }}</text></view
          ><text v-if="order.readOnly" class="small">历史订单 · 只读</text
          ><view v-for="item in orderItemSummary(order).items" :key="item.id" class="order-item"
            ><image v-if="item.imageSnapshot" class="product-link"
              :src="item.imageSnapshot"
            mode="aspectFit" @click.stop="openProduct(item)"
            /><view v-else class="no-image">暂无图片</view><view
              ><b>{{ item.nameSnapshot || '商品名称未获取' }}</b
              ><text class="small">{{ item.specificationSnapshot }}</text
              ><text
                >{{ money(item.unitPriceCents) }} × {{ item.quantity }}</text
              ></view
            ></view
          ><view v-if="orderItemSummary(order).quantity === null" class="small">商品明细未获取</view
          ><view class="order-total"
            >{{ orderItemSummary(order).quantity === null ? '商品数量未获取' : '共 ' + orderItemSummary(order).quantity + ' 件' }}，
            {{ order.readOnly ? '订单金额' : order.paidAt ? '支付金额' : '应付' }} <b>{{ money(order.payableCents) }}</b></view
          ></view
        ></view
      ><view v-else-if="!error" class="empty card">{{ loading ? '正在读取订单…' : '当前没有订单' }}</view></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad, onShow, onHide, onUnload } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money } from "../../api";
import { orderItemSummary } from "../../commerce-model";
const tabs = [
    { label: "全部", value: "" },
    { label: "待付款", value: "PENDING_PAYMENT" },
    { label: "待发货", value: "WAITING_FULFILLMENT" },
    { label: "待收货", value: "SHIPPED" },
    { label: "售后", value: "AFTER_SALE" },
  ],
  status = ref(""),
  orders = ref<any[]>([]), error = ref(""), loading = ref(false);
let revision = 0;
onLoad(o=>{status.value=o?.group==='pending_shipment'?'WAITING_FULFILLMENT':o?.group==='after_sales'?'AFTER_SALE':String(o?.status || '');});
onShow(load);
onHide(() => { revision++; });
onUnload(() => { revision++; });
async function load() {
  const request = ++revision;
  orders.value=[];
  error.value=""; loading.value=true;
  try {
    const group = status.value === "WAITING_FULFILLMENT" ? "pending_shipment" : status.value === "AFTER_SALE" ? "after_sales" : "";
    const query = group ? `group=${group}` : `status=${encodeURIComponent(status.value)}`;
    const rows = await api<any[]>(`/storefront/orders?${query}`, {
      auth: true,
    });
    if (request === revision) orders.value = rows;
  } catch (e) {
    if (request === revision) error.value = e instanceof Error ? e.message : "订单暂时无法读取，请重试";
  } finally {
    if (request === revision) loading.value=false;
  }
}
function select(v: string) {
  status.value = v;
  void load();
}
function open(id: string) {
  uni.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
}
function openProduct(item: any) {
  if (item?.productId) uni.navigateTo({ url: `/pages/product/index?id=${encodeURIComponent(item.productId)}` });
}
function browse() {
  uni.switchTab({ url: '/pages/home/index' });
}
const labels: any = {
  PENDING_PAYMENT: "待付款",
  PAID: "已支付",
  ERP_SYNCING: "同步中",
  WAITING_FULFILLMENT: "待发货",
  SHIPPED: "待收货",
  RECEIVED: "已完成",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  AFTER_SALE: "售后中",
  REFUNDED: "已退款",
  CLOSED: "已关闭",
};
function label(v: string) {
  return labels[v] || v;
}
</script>
<style scoped lang="scss">
.tabs {
  display: flex;
  white-space: nowrap;
  margin-bottom: 24rpx;
  background: #fff;
  border-radius: 16rpx;
}
.tabs button {
  display: inline-flex;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 10px 4px;
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
}
.tabs button::after { border: 0; }
.tabs button:focus-visible { outline: 2px solid var(--green); outline-offset: -3px; }
.browse-link { width: fit-content; margin: 0 0 10px auto; padding: 8px 14px; min-height: 44px; font-size: 14px; color: var(--green); background: #fff; }
.tabs .active {
  color: var(--green);
  font-weight: 850;
  border-bottom-color: var(--green);
}
.orders {
  display: grid;
  gap: 20rpx;
}
.order-no {
  color: var(--muted);
  font-size: 22rpx;
}
.order-item {
  display: grid;
  grid-template-columns: 130rpx 1fr;
  gap: 18rpx;
  padding: 24rpx 0;
  border-bottom: 1px solid var(--line);
}
.order-item image, .no-image {
  width: 130rpx;
  height: 130rpx;
  border-radius: 14rpx;
}
.product-link { cursor: pointer; }
.no-image { display: grid; place-items: center; background: #f5f5f5; font-size: 12px; color: var(--muted); }
.order-item b,
.order-item .small,
.order-item text {
  display: block;
}
.order-item .small {
  color: var(--muted);
  margin: 9rpx 0;
}
.order-total {
  text-align: right;
  margin-top: 22rpx;
}
.order-total b {
  color: #d95f29;
  font-size: 30rpx;
}
@media (min-width: 900px) {
  .orders {
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }
  .tabs button {
    flex: none;
    padding: 16px 28px;
  }
  .order {
    cursor: pointer;
  }
}
</style>
