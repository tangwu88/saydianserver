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
    <view class="app-panel account-menu"><button @click="help('agreement')"><text>用户协议</text><text class="chevron">›</text></button><button @click="help('privacy')"><text>隐私政策</text><text class="chevron">›</text></button></view>
    <button v-if="user" class="outline-btn logout" @click="$emit('logout')">退出登录</button>
    <text class="copyright">Saydian · 用心守护每一天</text>
  </view></view>
</template>
<script setup lang="ts">
import { computed } from "vue";
import DesktopHeader from "./DesktopHeader.vue";
const props = defineProps<{ user: any; error?: string; loading?: boolean }>(); defineEmits<{ logout: []; refresh: [] }>();
const memberNumber = computed(() => /^\d+$/.test(String(props.user?.memberNo || '')) ? String(props.user.memberNo) : '未获取');
function login() { uni.navigateTo({ url: "/pages/login/index" }); }
function help(section: string) { uni.navigateTo({ url: "/pages/help/index?section=" + section }); }
</script>
<style lang="scss">@import "../global-ui.scss";</style>
<style scoped>.account-content{max-width:600px;margin:0 auto}.account-content>h1{text-align:center;font-size:20px;margin-bottom:26px}.member-hero{display:flex;align-items:center;gap:15px;padding:24px 20px;border:1px solid #f0d9dd;border-radius:24px;background:linear-gradient(135deg,#fff8f3,#ffecee);box-shadow:0 10px 22px #9e102509;margin-bottom:18px}.avatar{width:60px;height:60px;border-radius:50%;background:#fff;color:#d20b27;display:flex;align-items:center;justify-content:center;flex:none;font-size:30px;font-weight:800}.member-name{min-width:0;overflow-wrap:anywhere}.member-name .muted{margin-top:6px}.account-details{padding:4px 18px}.detail-row{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:18px 0;font-size:15px;border-bottom:1px solid #dde3ec}.detail-row:last-child{border:0}.detail-row>view,.detail-row>text:last-child{text-align:right;overflow-wrap:anywhere}.pending{font-size:12px;color:#8a4b00;background:#fff6de;border-radius:5px;padding:2px 6px;margin-left:8px;white-space:nowrap}.account-menu{padding:0 18px;margin-top:18px}.account-menu button{display:flex;justify-content:space-between;align-items:center;padding:17px 0;margin:0;background:none;border-radius:0;font-size:16px;color:#171b2b;text-align:left;border-bottom:1px solid #dde3ec}.account-menu button:last-child{border:0}.chevron{font-size:25px;color:#98a2b3;line-height:1}.logout{width:100%;margin-top:24px}.copyright{display:block;text-align:center;color:#98a2b3;font-size:12px;line-height:1.8;margin-top:30px}@media(max-width:380px){.member-hero{padding:20px 16px}.detail-row{flex-wrap:wrap;gap:8px}.pending{display:inline-block}}</style>
