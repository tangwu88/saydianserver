<template>
  <DesktopHeader /><view v-if="order" class="page"
    ><view class="container detail-layout"
      ><view
        ><view class="status-card card"
          ><text>{{ label(order.status) }}</text
          ><text class="small">{{ statusHelp(order.status) }}</text></view
        ><view v-if="order.shipments?.length" class="card block"
          ><view class="block-title">物流信息</view
          ><view v-for="ship in order.shipments" :key="ship.id"
            ><b>{{ ship.logisticsCompany }} {{ ship.trackingNo }}</b
            ><text class="small"
              >发货时间：{{ date(ship.shippedAt) }}</text
            ></view
          ></view
        ><view class="card block"
          ><view class="block-title">收货信息</view
          ><b>{{ order.recipientName }} {{ order.recipientMobile }}</b
          ><text class="small"
            >{{ order.province }}{{ order.city }}{{ order.district
            }}{{ order.addressDetail }}</text
          ></view
        ><view class="card block"
          ><view class="block-title">商品信息</view
          ><view v-for="item in order.items" :key="item.id" class="item"
            ><image
              :src="item.imageSnapshot || productPlaceholder"
              mode="aspectFill"
            /><view
              ><b>{{ item.nameSnapshot }}</b
              ><text class="small">{{ item.specificationSnapshot }}</text
              ><text
                >{{ money(item.unitPriceCents) }} × {{ item.quantity }}</text
              ></view
            ></view
          ></view
        ><view v-if="order.afterSales?.length" class="card block"
          ><view class="block-title">售后进度</view
          ><view v-for="item in order.afterSales" :key="item.id" class="after"
            ><b>{{ afterLabel(item.type) }} · {{ labelAfter(item.status) }}</b
            ><text class="small"
              >{{ item.reason }} · {{ money(item.requestedCents) }}</text
            ></view
          ></view
        ></view
      ><view class="card aside"
        ><view class="line"
          ><text>订单号</text><b selectable>{{ order.orderNo }}</b></view
        ><view class="line"
          ><text>商品金额</text><b>{{ money(order.subtotalCents) }}</b></view
        ><view class="line"
          ><text>优惠</text><b>-{{ money(order.discountCents) }}</b></view
        ><view class="line"
          ><text>运费</text><b>{{ money(order.shippingCents) }}</b></view
        ><view class="line total"
          ><text>实付</text><b>{{ money(order.payableCents) }}</b></view
        ><view
          v-if="order.status === 'PENDING_PAYMENT'"
          class="primary-btn"
          @click="repay"
          >继续支付</view
        ><view
          v-if="order.status === 'PENDING_PAYMENT'"
          class="outline-btn"
          @click="cancel"
          >取消订单</view
        ><view
          v-if="order.status === 'SHIPPED'"
          class="primary-btn"
          @click="receipt"
          >确认收货</view
        ><view v-if="canAfterSale" class="outline-btn" @click="afterSale"
          >申请退款/退货/换货</view
        ></view
      ></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, money, productPlaceholder, toast } from "../../api";
const order = ref<any>(),
  id = ref("");
const canAfterSale = computed(
  () =>
    ["PAID", "WAITING_FULFILLMENT", "SHIPPED", "RECEIVED"].includes(
      order.value?.status,
    ) &&
    !order.value?.afterSales?.some(
      (x: any) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(x.status),
    ),
);
onLoad(async (o) => {
  id.value = o?.id || "";
  await load();
});
async function load() {
  try {
    order.value = await api(`/storefront/orders/${id.value}`, { auth: true });
  } catch (e) {
    toast(e);
  }
}
async function cancel() {
  try {
    await api(`/storefront/orders/${id.value}/cancel`, {
      method: "POST",
      auth: true,
    });
    await load();
  } catch (e) {
    toast(e);
  }
}
async function receipt() {
  try {
    await api(`/storefront/orders/${id.value}/receipt`, {
      method: "POST",
      auth: true,
    });
    await load();
  } catch (e) {
    toast(e);
  }
}
function afterSale() {
  uni.navigateTo({ url: `/pages/after-sale/index?orderId=${id.value}` });
}
function repay() {
  uni.showToast({ title: "请从订单支付入口选择支付方式", icon: "none" });
}
const labels: any = {
  PENDING_PAYMENT: "等待付款",
  PAID: "支付成功",
  ERP_SYNCING: "正在同步 ERP",
  WAITING_FULFILLMENT: "等待发货",
  SHIPPED: "已发货",
  RECEIVED: "已签收",
  CANCELLED: "订单已取消",
  AFTER_SALE: "售后处理中",
  REFUNDED: "退款完成",
  CLOSED: "订单已关闭",
};
function label(v: string) {
  return labels[v] || v;
}
function statusHelp(v: string) {
  return v === "SHIPPED"
    ? "商品正在配送，请留意物流动态"
    : v === "WAITING_FULFILLMENT"
      ? "订单已同步，仓库正在处理"
      : v === "PENDING_PAYMENT"
        ? "请在订单关闭前完成支付"
        : "订单状态会与聚水潭 ERP 保持同步";
}
const afterLabels: any = {
  APPLIED: "已申请",
  ERP_SYNCING: "同步中",
  PROCESSING: "处理中",
  WAITING_RETURN: "待寄回",
  RECEIVED: "已收货",
  REFUNDING: "退款中",
  COMPLETED: "已完成",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
};
function labelAfter(v: string) {
  return afterLabels[v] || v;
}
function afterLabel(v: string) {
  return v === "REFUND_ONLY"
    ? "仅退款"
    : v === "RETURN_REFUND"
      ? "退货退款"
      : "换货";
}
function date(v: string) {
  return v ? new Date(v).toLocaleString() : "-";
}
</script>
<style scoped lang="scss">
.detail-layout {
  display: grid;
  gap: 22rpx;
}
.detail-layout > view {
  display: grid;
  gap: 22rpx;
}
.status-card {
  background: linear-gradient(135deg, #195e52, #2a8c78);
  color: #fff;
}
.status-card text {
  display: block;
  font-size: 42rpx;
  font-weight: 900;
}
.status-card .small {
  display: block;
  color: #d1ebe4;
  margin-top: 12rpx;
}
.block-title {
  font-size: 30rpx;
  font-weight: 850;
  margin-bottom: 24rpx;
}
.block .small {
  display: block;
  color: var(--muted);
  margin-top: 10rpx;
  line-height: 1.6;
}
.item {
  display: grid;
  grid-template-columns: 130rpx 1fr;
  gap: 18rpx;
  padding: 18rpx 0;
  border-top: 1px solid var(--line);
}
.item image {
  width: 130rpx;
  height: 130rpx;
  border-radius: 14rpx;
}
.item b,
.item .small,
.item text {
  display: block;
}
.after {
  padding: 16rpx 0;
  border-top: 1px solid var(--line);
}
.line {
  display: flex;
  justify-content: space-between;
  margin-bottom: 22rpx;
}
.line b {
  max-width: 68%;
  text-align: right;
}
.line.total {
  padding-top: 22rpx;
  border-top: 1px solid var(--line);
}
.total b {
  color: #d95f29;
  font-size: 36rpx;
}
.aside .primary-btn,
.aside .outline-btn {
  margin-top: 16rpx;
}
@media (min-width: 900px) {
  .detail-layout {
    grid-template-columns: 1fr 360px;
    gap: 28px;
    align-items: start;
  }
  .aside {
    position: sticky;
    top: 108px;
  }
}
</style>
