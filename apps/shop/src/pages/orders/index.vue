<template>
  <DesktopHeader /><view class="page"
    ><view class="container"
      ><scroll-view scroll-x class="tabs"
        ><text
          v-for="tab in tabs"
          :key="tab.value"
          :class="status === tab.value && 'active'"
          @click="select(tab.value)"
          >{{ tab.label }}</text
        ></scroll-view
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
            ><image
              :src="item.imageSnapshot || productPlaceholder"
            mode="aspectFit"
            /><view
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
      ><view v-else class="empty card">当前没有订单</view></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad, onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money, productPlaceholder, toast } from "../../api";
import { orderItemSummary } from "../../commerce-model";
const tabs = [
    { label: "全部", value: "" },
    { label: "待付款", value: "PENDING_PAYMENT" },
    { label: "待发货", value: "WAITING_FULFILLMENT" },
    { label: "待收货", value: "SHIPPED" },
    { label: "售后", value: "AFTER_SALE" },
  ],
  status = ref(""),
  orders = ref<any[]>([]);
onLoad(o=>{status.value=String(o?.status || '');});
onShow(load);
async function load() {
  orders.value=[];
  try {
    orders.value = await api(`/storefront/orders?status=${status.value}`, {
      auth: true,
    });
  } catch (e) {
    toast(e);
  }
}
function select(v: string) {
  status.value = v;
  void load();
}
function open(id: string) {
  uni.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
}
const labels: any = {
  PENDING_PAYMENT: "待付款",
  PAID: "已支付",
  ERP_SYNCING: "同步中",
  WAITING_FULFILLMENT: "待发货",
  SHIPPED: "待收货",
  RECEIVED: "已完成",
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
  white-space: nowrap;
  margin-bottom: 24rpx;
  background: #fff;
  border-radius: 16rpx;
}
.tabs text {
  display: inline-flex;
  padding: 26rpx 34rpx;
  color: var(--muted);
}
.tabs .active {
  color: var(--green);
  font-weight: 850;
  border-bottom: 5rpx solid var(--green);
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
.order-item image {
  width: 130rpx;
  height: 130rpx;
  border-radius: 14rpx;
}
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
  .tabs text {
    padding: 16px 28px;
  }
  .order {
    cursor: pointer;
  }
}
</style>
