<script setup lang="ts">
import { reactive, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { api } from "../../api";
import { mallStorage } from "../../realm";
import DesktopHeader from "../../components/DesktopHeader.vue";
const status = ref<any>(),
  error = ref(""),
  busy = ref(false),
  authorized = ref(false),
  autoLogin = ref(false),
  next = ref("/"),
  challenge = ref("");
const isWechat =
  typeof navigator !== "undefined" &&
  /micromessenger/i.test(navigator.userAgent);
function back() {
  uni.switchTab({ url: "/pages/profile/index" });
}
const form = reactive({
  name: "",
  contactName: "",
  mobile: "",
  region: "",
  description: "",
});
let requestId = "",
  autoStarted = false;
function safeNext(value: unknown) {
  return typeof value === "string" &&
    /^(?:\/(?:promotion|members|products|orders|wallet|ledger|deposit|certificate)?|\/recharges\/[a-f0-9-]{36})$/.test(
      value,
    )
    ? value
    : "/";
}
function returnRoute() {
  return `/pages/partner/index?autoLogin=${autoLogin.value ? "1" : "0"}&next=${encodeURIComponent(next.value)}&challenge=${encodeURIComponent(challenge.value)}`;
}
function login() {
  mallStorage.set("saidian-post-login-route", returnRoute());
  uni.navigateTo({ url: "/pages/login/index" });
}
function partnerAccountLogin() {
  /* #ifdef H5 */
  window.location.assign(`/vip/login?password=1&next=${encodeURIComponent(next.value)}`);
  /* #endif */
}
async function load() {
  authorized.value = !!mallStorage.get("saidian-token");
  if (!authorized.value || busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    status.value = await api("/partner/status", { auth: true });
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : "申请进度暂时无法获取";
  } finally {
    busy.value = false;
  }
  if (autoLogin.value && !autoStarted && status.value?.partner?.active) {
    autoStarted = true;
    await enter();
  }
}
async function enter() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (!challenge.value) {
      /* #ifdef H5 */
      window.location.assign(
        `/vip/auth/member-start?next=${encodeURIComponent(next.value)}`,
      );
      /* #endif */
      return;
    }
    const result: any = await api("/partner/login-ticket", {
      method: "POST",
      auth: true,
      data: { codeChallenge: challenge.value },
    });
    /* #ifdef H5 */
    window.location.assign(
      `/vip/auth/member-callback#ticket=${encodeURIComponent(result.ticket)}&next=${encodeURIComponent(next.value)}`,
    );
    /* #endif */
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : "暂时无法进入合作平台";
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (busy.value) return;
  if (Object.values(form).some((value) => !value.trim())) {
    error.value = "请填写完整的申请信息";
    return;
  }
  if (!requestId)
    requestId = `apply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  busy.value = true;
  error.value = "";
  try {
    await api("/partner/applications", {
      method: "POST",
      auth: true,
      data: { ...form, idempotencyKey: requestId },
    });
    requestId = "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "提交未完成，请重试";
  } finally {
    busy.value = false;
  }
  if (!error.value) await load();
}
onLoad((options) => {
  autoLogin.value = options?.autoLogin === "1";
  next.value = safeNext(options?.next);
  challenge.value = /^[A-Za-z0-9_-]{43}$/.test(String(options?.challenge || ""))
    ? String(options?.challenge)
    : "";
});
onShow(() => {
  void load();
});
</script>
<template>
  <DesktopHeader /><view class="saydian-app-surface"
    ><view class="partner-content">
      <h1>{{ status?.partner ? "合作伙伴平台" : "申请合作伙伴" }}</h1>
      <view v-if="error" class="error-state" role="alert"
        >{{ error
        }}<button class="text-button" @click="load">重新查询</button></view
      >
      <view v-if="!authorized" class="app-panel partner-panel"
        ><h2>先登录商城会员</h2>
        <p>申请、审核结果和合作账户将与该会员绑定。</p>
        <button class="primary-btn" @click="login">
          {{ isWechat ? "登录 / 微信授权" : "登录会员账号" }}
        </button></view
      >
      <view v-else-if="status?.partner" class="app-panel partner-panel"
        ><h2>{{ status.partner.name }}</h2>
        <p>
          {{ status.partner.level?.name }} ·
          {{ status.partner.active ? "已开通" : "账户已停用，请联系赛电" }}
        </p>
        <button
          v-if="status.partner.active"
          class="primary-btn"
          :disabled="busy"
          @click="enter"
        >
          进入合作平台</button
        ><text class="muted"
          >账号：{{
            status.partner.username
          }}。需要密码登录时，可联系管理员重置密码。</text
        ></view
      >
      <view
        v-else-if="status?.application?.status === 'PENDING'"
        class="app-panel partner-panel"
        ><h2>申请已提交，等待审核</h2>
        <p>{{ status.application.name }}</p>
        <p>
          {{ status.application.contactName }} · {{ status.application.mobile }}
        </p>
        <button class="outline-btn" :disabled="busy" @click="load">
          查看最新进度
        </button></view
      >
      <form
        v-else-if="status"
        class="app-panel partner-panel"
        @submit.prevent="submit"
      >
        <view
          v-if="status.application?.status === 'REJECTED'"
          class="error-state"
          >本次未通过：{{
            status.application.reviewReason
          }}。可修改信息后重新申请。</view
        >
        <label
          >合作名称<input
            v-model="form.name"
            maxlength="80"
            placeholder="公司、门店或个人名称"
        /></label>
        <label
          >联系人<input
            v-model="form.contactName"
            maxlength="40"
            placeholder="姓名"
        /></label>
        <label
          >联系电话<input
            v-model="form.mobile"
            type="text"
            maxlength="30"
            placeholder="便于联系的手机号"
        /></label>
        <label
          >所在地区<input
            v-model="form.region"
            maxlength="120"
            placeholder="省、市、区"
        /></label>
        <label
          >合作介绍<textarea
            v-model="form.description"
            maxlength="2000"
            placeholder="经营情况、合作意向等"
          />
        </label>
        <button class="primary-btn" form-type="submit" :disabled="busy">
          {{ busy ? "正在提交…" : "提交申请" }}
        </button>
      </form>
      <!-- #ifdef H5 -->
      <button class="text-button" @click="partnerAccountLogin">已有合作账号？使用账号密码登录</button>
      <!-- #endif -->
      <button class="text-button" @click="back">返回个人中心</button>
    </view></view
  >
</template>
<style lang="scss">
@import "../../global-ui.scss";
</style>
<style scoped>
.partner-content {
  max-width: 620px;
  margin: 0 auto;
}
.partner-content h1 {
  font-size: 24px;
  margin: 12px 0 24px;
}
.partner-panel {
  padding: 24px;
  margin-bottom: 20px;
}
.partner-panel p {
  line-height: 1.7;
  color: #596579;
  margin: 12px 0 20px;
}
.partner-panel label {
  display: grid;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 20px;
}
.partner-panel input,
.partner-panel textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #dce1ea;
  border-radius: 9px;
  font-size: 16px;
  font-weight: 400;
  min-height: 46px;
}
.partner-panel textarea {
  height: 120px;
}
.partner-panel button {
  margin: 12px 0;
}
.partner-panel .muted {
  display: block;
  font-size: 13px;
  line-height: 1.7;
  margin-top: 16px;
}
@media (max-width: 600px) {
  .partner-panel {
    padding: 20px;
  }
  .partner-content h1 {
    font-size: 22px;
  }
}
</style>
