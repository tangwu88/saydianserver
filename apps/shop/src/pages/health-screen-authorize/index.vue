<script setup lang="ts">
import { ref } from "vue";
import { onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { api, requireLogin, mallSessionStamp } from "../../api";
const scan = ref(""),
  code = ref(""),
  name = ref(""),
  error = ref(""),
  done = ref(false),
  busy = ref(false),
  expires = ref(0);
let version = 0,
  owner = "";
onLoad((query: any) => {
  scan.value = typeof query?.scan === "string" ? query.scan : "";
});
onUnload(() => {
  ++version;
});
async function load() {
  if (done.value) return;
  const n = ++version;
  code.value = "";
  name.value = "";
  error.value = "";
  busy.value = true;
  try {
    if (!/^[a-f0-9]{64}$/.test(scan.value))
      throw Error("二维码无效，请在大屏刷新后重新扫描");
    if (
      typeof navigator === "undefined" ||
      !/MicroMessenger/i.test(navigator.userAgent)
    )
      throw Error("请用手机微信扫描大屏上的二维码");
    const state = await api<{ match: string; expiresAt: string }>(
      "/auth/health-screen/scan",
      { method: "POST", data: { scan: scan.value } },
    );
    if (version !== n) return;
    const route =
      "/pages/health-screen-authorize/index?scan=" +
      encodeURIComponent(scan.value);
    if (!requireLogin(route)) return;
    const stamp = mallSessionStamp();
    const user = await api<{ nickname?: string; id: string }>(
      "/auth/wechat/h5/account",
      { auth: true, sessionStamp: stamp },
    );
    if (n !== version || mallSessionStamp() !== stamp) return;
    owner = stamp;
    name.value = user.nickname || "当前会员";
    code.value = state.match;
    expires.value = Date.parse(state.expiresAt);
  } catch (e) {
    if (version === n)
      error.value = e instanceof Error ? e.message : "暂时无法确认登录";
  } finally {
    if (version === n) busy.value = false;
  }
}
async function approve() {
  if (busy.value || !code.value || done.value) return;
  if (owner !== mallSessionStamp()) {
    await load();
    return;
  }
  if (Date.now() >= expires.value) {
    code.value = "";
    error.value = "二维码已过期，请在大屏刷新";
    return;
  }
  const n = version;
  busy.value = true;
  try {
    await api("/auth/health-screen/approve", {
      auth: true,
      sessionStamp: owner,
      method: "POST",
      data: { scan: scan.value },
    });
    if (n === version) done.value = true;
  } catch (e) {
    if (n === version)
      error.value = e instanceof Error ? e.message : "确认失败";
  } finally {
    if (n === version) busy.value = false;
  }
}
function cancel() {
  uni.reLaunch({ url: "/pages/profile/index" });
}
onShow(() => void load());
</script>
<template>
  <view class="authorize"
    ><view class="auth-card"
      ><h1>{{ done ? "已确认登录" : "确认登录健康大屏" }}</h1>
      <p v-if="done">请返回刚才扫码的大屏查看。</p>
      <template v-else-if="code"
        ><p>{{ name }}，请核对面前大屏上的数字。</p>
        <strong>{{ code }}</strong>
        <p>确认后，该浏览器可查看你的健康数据并使用本账号的大屏权限。</p>
        <button class="primary-btn" :disabled="busy" @click="approve">
          确认是我的大屏</button
        ><button v-if="!busy" @click="cancel">取消</button></template
      >
      <p v-else-if="busy">正在验证二维码…</p>
      <p v-if="error" role="alert">{{ error }}</p></view
    ></view
  >
</template>
<style scoped>
.authorize {
  min-height: 90vh;
  padding: 48px 20px;
  background: #061c30;
  color: #e5f6ff;
}
.auth-card {
  max-width: 420px;
  margin: auto;
  padding: 24px;
  border-radius: 16px;
  background: #103148;
  line-height: 1.6;
}
.auth-card h1 {
  font-size: 24px;
}
.auth-card strong {
  display: block;
  text-align: center;
  font-size: 40px;
  letter-spacing: 8px;
  color: #65e0ed;
}
.auth-card button {
  margin-top: 12px;
}
</style>
