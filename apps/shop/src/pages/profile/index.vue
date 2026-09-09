<template>
  <DesktopHeader /><view class="page"
    ><view class="container profile-layout"
      ><view
        ><view class="profile-hero card"
          ><view class="avatar">S</view
          ><view
            ><text>{{ user?.nickname || "欢迎来到赛电商城" }}</text
            ><text class="small">{{
              user?.mobile || "登录后查看订单与售后进度"
            }}</text></view
          ><view
            v-if="!user"
            class="outline-btn"
            @click="go('/pages/login/index')"
            >立即登录</view
          ></view
        ><view class="quick card"
          ><view @click="go('/pages/orders/index')"
            ><b>全部</b><text class="small">订单</text></view
          ><view @click="go('/pages/orders/index?status=PENDING_PAYMENT')"
            ><b>待付</b><text class="small">付款</text></view
          ><view @click="go('/pages/orders/index?status=SHIPPED')"
            ><b>待收</b><text class="small">物流</text></view
          ><view @click="go('/pages/orders/index?status=AFTER_SALE')"
            ><b>售后</b><text class="small">进度</text></view
          ></view
        ><view class="menu card"
          ><view v-for="item in menus" :key="item.url" @click="go(item.url)"
            ><text>{{ item.icon }}</text
            ><b>{{ item.label }}</b
            ><text class="small">›</text></view
          ></view
        ></view
      ><view class="member card"
        ><text>赛电商城服务</text
        ><text class="small"
          >商品说明、库存、订单与售后进度均以商城页面为准。</text
        ><view class="service-grid"
          ><view><b>正品</b><text class="small">官方商城</text></view
          ><view><b>支付</b><text class="small">以已开通渠道为准</text></view
          ><view><b>售后</b><text class="small">全程可查</text></view></view
        ><button v-if="user" class="outline-btn" @click="logout">退出顾客账号</button></view
      ></view
    ></view
  >
  <StoreFooter />
</template>
<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import StoreFooter from "../../components/StoreFooter.vue";
import { clearMallSession, toast } from "../../api";
const user = ref<any>();
const menus = [
  { icon: "地", label: "收货地址", url: "/pages/addresses/index" },
  { icon: "藏", label: "我的收藏", url: "/pages/favorites/index" },
  { icon: "券", label: "优惠券", url: "/pages/coupons/index" },
  { icon: "分", label: "积分与流水", url: "/pages/points/index" },
  { icon: "票", label: "发票信息", url: "/pages/help/index?section=invoice" },
  { icon: "服", label: "客服与帮助", url: "/pages/help/index" },
  { icon: "推", label: "员工推广中心", url: "/pages/employee/index" },
];
onShow(() => {
  user.value = uni.getStorageSync("saidian-user") || null;
});
function go(url: string) {
  uni.navigateTo({ url });
}
async function logout() {
  const answer = await uni.showModal({title:'退出顾客账号',content:'本地购物与个人缓存将清理，订单和积分保留在服务端。员工身份不受影响。'});
  if (!answer.confirm) return;
  try {
    await clearMallSession(); user.value = null;
    uni.reLaunch({url:'/pages/profile/index'});
  } catch (error) { toast(error); }
}
</script>
<style scoped lang="scss">
.profile-layout {
  display: grid;
  gap: 22rpx;
}
.profile-layout > view {
  display: grid;
  gap: 22rpx;
}
.profile-hero {
  display: flex;
  align-items: center;
  gap: 20rpx;
  background: #005bad;
  color: #fff;
}
.avatar {
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  background: #ffffff;
  color: #be092d;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  font-weight: 900;
}
.profile-hero > view:nth-child(2) {
  flex: 1;
}
.profile-hero text,
.profile-hero .small {
  display: block;
}
.profile-hero text {
  font-size: 32rpx;
  font-weight: 850;
}
.profile-hero .small {
  color: #cce6df;
  margin-top: 10rpx;
}
.profile-hero .outline-btn {
  width: 160rpx;
  height: 64rpx;
  background: transparent;
  color: #fff;
}
.quick {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  text-align: center;
}
.quick b,
.quick .small {
  display: block;
}
.quick b {
  color: var(--green);
  font-size: 28rpx;
}
.quick .small {
  color: var(--muted);
  margin-top: 8rpx;
}
.menu > view {
  display: grid;
  grid-template-columns: 58rpx 1fr 20rpx;
  align-items: center;
  min-height: 90rpx;
  border-bottom: 1px solid var(--line);
}
.menu > view:last-child {
  border: 0;
}
.menu > view > text {
  width: 46rpx;
  height: 46rpx;
  border-radius: 14rpx;
  background: var(--mint);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--green);
}
.menu .small {
  color: #a7b0ad;
}
.member {
  background: #fff;
}
.member > text {
  display: block;
  font-size: 31rpx;
  font-weight: 850;
}
.member > .small {
  display: block;
  color: #7c7668;
  line-height: 1.7;
  margin: 16rpx 0 28rpx;
}
.service-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  text-align: center;
}
.service-grid b,
.service-grid .small {
  display: block;
}
.service-grid .small {
  color: var(--muted);
  font-size: 20rpx;
  margin-top: 5rpx;
}
@media (min-width: 900px) {
  .profile-layout {
    grid-template-columns: 1fr 360px;
    align-items: start;
    gap: 28px;
  }
  .member {
    position: sticky;
    top: 108px;
  }
}
</style>
