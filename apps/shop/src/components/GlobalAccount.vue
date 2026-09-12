<template>
  <DesktopHeader />
  <view class="saydian-app-surface account-surface"><view class="account-content">
    <h1>我的</h1>
    <view v-if="error" class="error-state">{{ error }}<button class="text-button" :disabled="!!loading" @click="$emit('refresh')">重试</button></view>
    <view class="member-hero">
      <view class="avatar" aria-hidden="true">{{ user?.nickname?.slice(0, 1) || 'S' }}</view>
      <view class="member-name"><h2>{{ user?.nickname || '欢迎来到 Saydian' }}</h2><text class="muted">{{ user ? '会员 ID：' + memberNumber : '登录，开启贴心服务' }}</text></view>
    </view>
    <view v-if="user" class="app-panel account-details">
      <view v-if="user.phoneMasked" class="detail-row"><text>手机号</text><view><text>{{ user.phoneMasked }}</text><text v-if="user.phoneVerified === false" class="pending">待验证</text></view></view>
      <view v-if="user.emailMasked" class="detail-row"><text>邮箱</text><text>{{ user.emailMasked }}</text></view>
      <view v-if="!user.phoneMasked && !user.emailMasked" class="detail-row"><text>联系方式</text><text class="muted">未提供</text></view>
    </view>
    <button v-else class="primary-btn" @click="login">登录 / 注册</button>
    <view v-if="user?.phoneTestMode" class="verification-note">购买前需验证账号，请使用已验证的手机号或邮箱登录。<button class="text-button" @click="login">更换登录账号</button></view>
    <view v-if="user" class="app-panel recent-orders" aria-label="最近订单">
      <view class="recent-heading"><b>最近订单</b><button class="text-button" @click="go('/pages/orders/index')">查看全部 ›</button></view>
      <text v-if="recentOrdersLoading" class="muted recent-state">正在读取订单…</text>
      <view v-for="order in recentOrders || []" :key="order.id" class="recent-order" @click="openOrder(order.id)">
        <image v-if="order.items?.[0]?.imageSnapshot" :src="order.items[0].imageSnapshot" mode="aspectFit" />
        <view v-else class="recent-image-empty">暂无图片</view>
        <view class="recent-main"><b>{{ order.items?.[0]?.nameSnapshot || '订单商品' }}</b><text>{{ order.orderNo }}</text><text>{{ formatTime(order.createdAt) }}</text></view>
        <view class="recent-side"><b>{{ statusLabel(order.status) }}</b><text>{{ money(order.payableCents) }}</text><text>›</text></view>
      </view>
      <text v-if="recentOrdersError" class="recent-error">{{ recentOrdersError }}</text>
      <text v-else-if="!recentOrdersLoading && !(recentOrders || []).length" class="muted recent-state">暂无订单，去商城看看吧</text>
    </view>
    <view class="app-panel account-menu"><button v-for="item in shoppingMenus" :key="item.url" @click="go(item.url)"><text>{{ item.label }}</text><text class="chevron">›</text></button></view>
    <view class="app-panel account-menu"><button @click="help('agreement')"><text>用户协议</text><text class="chevron">›</text></button><button @click="help('privacy')"><text>隐私政策</text><text class="chevron">›</text></button></view>
    <button v-if="user" class="outline-btn logout" @click="$emit('logout')">退出登录</button>
    <text class="copyright">Saydian · 用心守护每一天</text>
  </view></view>
</template>
<script setup lang="ts">
import { computed } from "vue";
import DesktopHeader from "./DesktopHeader.vue";
const props = defineProps<{ user: any; error?: string; loading?: boolean; recentOrders?: any[]; recentOrdersLoading?: boolean; recentOrdersError?: string }>(); defineEmits<{ logout: []; refresh: [] }>();
const memberNumber = computed(() => /^\d+$/.test(String(props.user?.memberNo || '')) ? String(props.user.memberNo) : '未获取');
const shoppingMenus = [
  { label: '收货地址', url: '/pages/addresses/index' }, { label: '我的收藏', url: '/pages/favorites/index' },
  { label: '优惠券', url: '/pages/coupons/index' }, { label: '积分与流水', url: '/pages/points/index' },
  { label: '推广与奖金', url: '/pages/employee/index' },
  { label: '帮助与客服', url: '/pages/help/index?section=service' },
];
function go(url: string) { uni.navigateTo({ url }); }
function openOrder(id: string) { if (id) go('/pages/order-detail/index?id=' + encodeURIComponent(id)); }
function login() { uni.navigateTo({ url: "/pages/login/index" }); }
function help(section: string) { uni.navigateTo({ url: "/pages/help/index?section=" + section }); }
function money(value: unknown) { const cents = Number(value); return Number.isFinite(cents) ? `¥${(cents / 100).toFixed(2)}` : '金额未获取'; }
function formatTime(value: unknown) { const date = value ? new Date(String(value)) : null; return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '时间未获取'; }
function statusLabel(value: string) { return ({ PENDING_PAYMENT: '待付款', PAID: '已支付', ERP_SYNCING: '处理中', WAITING_FULFILLMENT: '待发货', SHIPPED: '待收货', RECEIVED: '已完成', COMPLETED: '已完成', CANCELLED: '已取消', AFTER_SALE: '售后中', REFUNDED: '已退款', CLOSED: '已关闭' } as Record<string,string>)[value] || '处理中'; }
</script>
<style scoped>.verification-note{margin-top:16px;padding:12px 16px;border-radius:12px;background:#fff6de;color:#79500b;font-size:14px;line-height:1.6}.recent-orders{margin-top:18px;padding:8px 18px}.recent-heading{display:flex;align-items:center;justify-content:space-between;padding:10px 0}.recent-heading .text-button{width:auto;margin:0;min-height:40px;padding:6px 0;font-size:13px}.recent-order{display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 0;border-top:1px solid #dde3ec;cursor:pointer}.recent-order image,.recent-image-empty{width:54px;height:54px;border-radius:9px}.recent-image-empty{display:grid;place-items:center;background:#f4f6f8;color:#98a2b3;font-size:10px}.recent-main,.recent-side{display:grid;gap:4px;min-width:0}.recent-main b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.recent-main text,.recent-side text{font-size:12px;color:#7b8595}.recent-side{text-align:right}.recent-side b{font-size:12px;color:#d20b27}.recent-state{display:block;padding:16px 0}.recent-error{display:block;padding:10px 0;color:#b33838;font-size:12px}</style>
<style lang="scss">@import "../global-ui.scss";</style>
<style scoped>.account-content{max-width:600px;margin:0 auto}.account-content>h1{text-align:center;font-size:20px;margin-bottom:26px}.member-hero{display:flex;align-items:center;gap:15px;padding:24px 20px;border:1px solid #f0d9dd;border-radius:24px;background:linear-gradient(135deg,#fff8f3,#ffecee);box-shadow:0 10px 22px #9e102509;margin-bottom:18px}.avatar{width:60px;height:60px;border-radius:50%;background:#fff;color:#d20b27;display:flex;align-items:center;justify-content:center;flex:none;font-size:30px;font-weight:800}.member-name{min-width:0;overflow-wrap:anywhere}.member-name .muted{margin-top:6px}.account-details{padding:4px 18px}.detail-row{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:18px 0;font-size:15px;border-bottom:1px solid #dde3ec}.detail-row:last-child{border:0}.detail-row>view,.detail-row>text:last-child{text-align:right;overflow-wrap:anywhere}.pending{font-size:12px;color:#8a4b00;background:#fff6de;border-radius:5px;padding:2px 6px;margin-left:8px;white-space:nowrap}.account-menu{padding:0 18px;margin-top:18px}.account-menu button{display:flex;justify-content:space-between;align-items:center;padding:17px 0;margin:0;background:none;border-radius:0;font-size:16px;color:#171b2b;text-align:left;border-bottom:1px solid #dde3ec}.account-menu button:last-child{border:0}.chevron{font-size:25px;color:#98a2b3;line-height:1}.logout{width:100%;margin-top:24px}.copyright{display:block;text-align:center;color:#98a2b3;font-size:12px;line-height:1.8;margin-top:30px}@media(max-width:380px){.member-hero{padding:20px 16px}.detail-row{flex-wrap:wrap;gap:8px}.pending{display:inline-block}}</style>
