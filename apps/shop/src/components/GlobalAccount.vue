<template><DesktopHeader /><view class="page"><view class="container card global-account"><h1>国际版会员账号</h1><template v-if="user"><h2>{{ user.nickname || '赛电会员' }}</h2><text>会员编号：{{ /^\d+$/.test(String(user.memberNo || '')) ? user.memberNo : '未获取' }}</text><text>邮箱：{{ user.emailMasked || '未提供' }}</text><text>手机号：{{ user.phoneMasked || '未提供' }}</text><button class="outline-btn" @click="$emit('logout')">退出国际账号</button></template><template v-else><text>使用国际版 App 的邮箱或国际手机号登录，也可在微信内授权绑定已有账号。</text><button class="primary-btn" @click="login">登录 / 微信绑定</button></template><p>{{ globalCommerceNotice }}</p><button class="outline-btn" @click="help">查看国际版协议与服务</button></view></view><StoreFooter /></template>
<script setup lang="ts">
import DesktopHeader from "./DesktopHeader.vue";
import StoreFooter from "./StoreFooter.vue";
import { globalCommerceNotice } from "../realm";
defineProps<{ user: any }>(); defineEmits<{ logout: [] }>();
function login() { uni.navigateTo({ url: "/pages/login/index" }); }
function help() { uni.navigateTo({ url: "/pages/help/index" }); }
</script>
<style scoped>.global-account{max-width:640px;box-sizing:border-box;overflow-wrap:anywhere}.global-account h1{font-size:24px}.global-account h2{font-size:20px}.global-account text{display:block;line-height:1.9}.global-account p{font-size:14px;color:#67717c;line-height:1.8}.global-account button{margin-top:20px}</style>
