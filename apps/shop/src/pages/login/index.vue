<template>
  <view class="login-page"
    ><view class="login-card"
      ><view class="logo">S</view><text class="title">登录赛电商城</text
      ><text class="small">订单、物流、售后进度一站查看</text
      ><template v-if="isWeComBrowser"
        ><text class="wecom-login-message"
          >正在登录企业微信员工账号…</text
        ></template
      ><template v-else
        ><!-- #ifdef MP-WEIXIN -->
        <button class="wechat-btn" @click="wechatLogin">微信一键登录</button>
        <!-- #endif -->
        <!-- #ifdef H5 -->
        <view class="mini-tip"
          ><b>微信登录与支付请使用赛电商城小程序</b
          ><text
            >当前 H5 不再调用公众号网页授权，可继续使用手机号登录。</text
          ></view
        >
        <!-- #endif -->
        <view class="divider"><text>手机号登录</text></view
        ><input
          v-model="mobile"
          class="input"
          maxlength="11"
          type="number"
          placeholder="请输入手机号"
        /><view class="code-row"
          ><input
            v-model="code"
            class="input"
            maxlength="6"
            type="number"
            placeholder="短信验证码"
          /><button @click="sendCode">
            {{ countdown ? `${countdown}s` : "获取验证码" }}
          </button></view
        ><label class="agreement"
          ><checkbox :checked="agreementAccepted" @click="agreementAccepted = !agreementAccepted" />
          <text>我已阅读并同意用户协议与隐私政策</text></label
        ><button class="primary-btn" @click="smsLogin">登录</button></template
      ></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { ref } from "vue";
import {
  api,
  COMMERCE_CONSENT_VERSION,
  ensureMiniProgramSession,
  toast,
} from "../../api";
import { bindReferral } from "../../session";
const mobile = ref(""),
  code = ref(""),
  countdown = ref(0),
  agreementAccepted = ref(false),
  isWeComBrowser = ref(
    typeof navigator !== "undefined" && /wxwork/i.test(navigator.userAgent),
  );
onLoad(async () => {
  /* #ifdef H5 */
  if (isWeComBrowser.value) {
    uni.reLaunch({ url: "/pages/employee/index" });
    return;
  }
  /* #endif */
});
async function sendCode() {
  if (countdown.value) return;
  try {
    const r: any = await api("/auth/sms/request", {
      method: "POST",
      data: { mobile: mobile.value },
    });
    if (r.devCode) code.value = r.devCode;
    countdown.value = 60;
    const timer = setInterval(() => {
      countdown.value--;
      if (!countdown.value) clearInterval(timer);
    }, 1000);
  } catch (e) {
    toast(e);
  }
}
async function save(r: any) {
  uni.setStorageSync("saidian-token", r.token);
  uni.setStorageSync("saidian-refresh-token", r.refreshToken);
  uni.setStorageSync("saidian-user", r.user);
  await bindReferral();
  const nextRoute = takePostLoginRoute();
  uni.showToast({ title: "登录成功" });
  setTimeout(
    () =>
      nextRoute
        ? uni.reLaunch({ url: nextRoute })
        : uni.switchTab({ url: "/pages/profile/index" }),
    600,
  );
}
async function smsLogin() {
  if (!agreementAccepted.value) return toast("请先阅读并同意用户协议与隐私政策");
  try {
    await save(
      await api("/auth/sms/login", {
        method: "POST",
        data: {
          mobile: mobile.value,
          code: code.value,
          consentVersion: COMMERCE_CONSENT_VERSION,
          referralCode: String(uni.getStorageSync("saidian-ref") || ""),
        },
      }),
    );
  } catch (e) {
    toast(e);
  }
}
async function wechatLogin() {
  /* #ifdef MP-WEIXIN */
  if (!agreementAccepted.value) return toast("请先阅读并同意用户协议与隐私政策");
  try {
    await ensureMiniProgramSession(true);
    await bindReferral();
    uni.showToast({ title: "登录成功" });
    setTimeout(() => uni.switchTab({ url: "/pages/profile/index" }), 600);
  } catch (e) {
    toast(e);
  }
  /* #endif */
}
function takePostLoginRoute(): string {
  const route = String(uni.getStorageSync("saidian-post-login-route") || "");
  uni.removeStorageSync("saidian-post-login-route");
  if (
    !/^\/pages\/[a-z0-9-]+\/index(?:\?|$)/i.test(route) ||
    route.startsWith("/pages/login/index")
  )
    return "";
  return route;
}
</script>
<style scoped lang="scss">
.login-page {
  min-height: 100vh;
  padding: 80rpx 30rpx;
  background: radial-gradient(circle at 50% 0, #dcefe9, #f5f7f8 46%);
  display: flex;
  justify-content: center;
}
.login-card {
  width: 100%;
  max-width: 760rpx;
  background: #fff;
  border-radius: 32rpx;
  padding: 52rpx 38rpx;
  box-shadow: 0 30rpx 80rpx rgba(18, 62, 56, 0.12);
  text-align: center;
}
.logo {
  width: 96rpx;
  height: 96rpx;
  margin: 0 auto;
  border-radius: 30rpx;
  background: linear-gradient(145deg, #247e6d, #123e38);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  font-weight: 900;
}
.title {
  display: block;
  font-size: 42rpx;
  font-weight: 900;
  margin-top: 28rpx;
}
.login-card > .small {
  display: block;
  color: var(--muted);
  margin: 14rpx 0 34rpx;
}
.wechat-btn {
  background: #20a86f;
  color: #fff;
  border: 0;
  border-radius: 999px;
}
.wecom-login-message {
  display: block;
  margin-top: 36rpx;
  color: var(--green);
  font-weight: 700;
}
.mini-tip {
  padding: 24rpx;
  border-radius: 18rpx;
  background: #edf7f3;
  color: #176b5b;
  text-align: left;
}
.mini-tip b,
.mini-tip text {
  display: block;
}
.mini-tip text {
  margin-top: 10rpx;
  color: #647773;
  font-size: 23rpx;
  line-height: 1.6;
}
.divider {
  margin: 34rpx 0;
  display: flex;
  align-items: center;
  color: #9aa5a2;
  font-size: 22rpx;
}
.divider:before,
.divider:after {
  content: "";
  height: 1px;
  background: var(--line);
  flex: 1;
}
.divider text {
  margin: 0 20rpx;
}
.input {
  margin-bottom: 18rpx;
  text-align: left;
}
.code-row {
  display: grid;
  grid-template-columns: 1fr 200rpx;
  gap: 16rpx;
}
.code-row button {
  height: 88rpx;
  background: var(--mint);
  color: var(--green);
  font-size: 24rpx;
  border: 0;
}
.primary-btn {
  margin-top: 16rpx;
}
.agreement {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  color: #9aa5a2;
  font-size: 20rpx;
  margin-top: 24rpx;
}
</style>
