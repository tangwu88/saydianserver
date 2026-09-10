<template>
  <DesktopHeader />
  <view class="page global-login"><view class="card login-card">
    <image class="logo" :src="brandLogo" mode="aspectFit" />
    <h1>{{ bindTicket ? '绑定国际版账号' : '国际版账号登录' }}</h1>
    <text class="muted">与赛电国际版 App 共用账号，与国内商城账号独立。</text>
    <view v-if="reading" class="legal-reader">
      <h2>{{ reading === 'userAgreement' ? '用户协议' : '隐私政策' }}</h2>
      <text class="muted">版本 {{ documents[reading]?.version }} · {{ documents[reading]?.locale }}</text>
      <text class="document">{{ legalPlainText(documents[reading]?.contentHtml || '') }}</text>
      <button class="outline-btn" @click="reading = null">返回登录</button>
    </view>
    <template v-else>
      <view v-if="error" class="error-state" role="alert">{{ error }}</view>
      <text v-if="loading" class="muted">正在读取国际登录方式与已发布协议…</text>
      <button v-if="!loading && (!capabilities || !legalReady)" class="outline-btn" :disabled="busy" @click="initialize(false)">重新加载登录方式与协议</button>
      <template v-if="bindTicket">
        <view class="notice">微信授权不代表邮箱或手机已验证。请验证已有账号；没有账号时，可通过已开通的验证码渠道创建。绑定页刷新后需重新微信授权。</view>
        <view class="tabs"><button v-for="item in bindingModes" :key="item.key" :class="{ active: mode === item.key }" :disabled="busy" @click="changeMode(item.key)">{{ item.label }}</button></view>
        <text class="muted" v-if="!bindingEnabled">{{ bindingReason }}</text>
      </template>
      <label class="form-label">{{ mode === 'email' ? '邮箱' : mode === 'sms' ? '国际手机号（含国家区号）' : '邮箱或国际手机号' }}
        <input v-model="identifier" :disabled="busy" class="input" maxlength="254" :placeholder="mode === 'sms' ? '+8613812345678' : 'name@example.com 或 +8613812345678'" @input="resetChallenge" />
      </label>
      <label class="form-label">{{ bindTicket && mode !== 'password' ? '已有账号填原密码；新账号设置密码' : '账号密码' }}
        <input v-model="password" :disabled="busy" password class="input" maxlength="72" placeholder="请输入密码" @confirm="login" />
      </label>
      <template v-if="bindTicket && mode !== 'password'">
        <text class="muted">密码至少 8 个字符、最多 72 个 UTF-8 字节。已有账号须同时验证原密码及验证码，不会重设密码；忘记密码请先通过国际版 App 正式找回。</text>
        <text v-if="mode === 'sms'" class="muted">支持地区：{{ capabilities?.login?.wechatBinding?.smsCountries?.join('、') || '尚未配置' }}</text>
        <view class="code-row"><input v-model="code" :disabled="busy" class="input" type="number" maxlength="6" placeholder="6 位验证码" /><button class="outline-btn" :disabled="busy || loading || countdown > 0 || !bindingEnabled" @click="sendCode">{{ countdown > 0 ? countdown + '秒后重试' : '获取验证码' }}</button></view>
        <text v-if="codeNote" class="muted">{{ codeNote }}</text>
      </template>
      <view class="agreement">
        <checkbox-group @change="accepted = !!$event.detail.value.length"><label><checkbox value="yes" :checked="accepted" :disabled="busy || !legalReady" />我已阅读并同意</label></checkbox-group>
        <button class="text-button" :disabled="busy || !legalReady" @click="reading = 'userAgreement'">用户协议</button><text>和</text><button class="text-button" :disabled="busy || !legalReady" @click="reading = 'privacyPolicy'">隐私政策</button>
        <text v-if="!legalReady && !loading" class="muted">已审核协议暂不可用，授权绑定暂不可用；已有账号仍可密码登录。</text>
      </view>
      <button class="primary-btn" :disabled="busy || loading || !capabilities || (bindTicket ? !bindingEnabled || !legalReady : !capabilities.login?.password?.enabled)" :loading="busy" @click="login">{{ bindTicket ? '验证并绑定' : '登录国际账号' }}</button>
      <template v-if="!bindTicket">
        <button class="outline-btn wechat" :disabled="busy || loading || !legalReady || !isWechat || !capabilities?.login?.wechatH5?.enabled" @click="officialLogin">微信授权登录 / 绑定账号</button>
        <text v-if="isWecom" class="muted">国际版尚未启用企业微信员工登录，请在普通微信或浏览器使用会员账号。</text>
        <text v-else-if="!isWechat" class="muted">公众号授权须在微信中打开本页面；普通浏览器可用邮箱或国际手机号登录。</text>
        <text v-if="capabilities && !capabilities.login?.wechatH5?.enabled" class="muted">{{ capabilities.login?.wechatH5?.reason || '公众号登录尚未配置' }}</text>
      </template>
      <button v-if="bindTicket" class="text-button" :disabled="busy" @click="cancelBinding">取消绑定，重新登录</button>
      <button class="text-button" :disabled="busy" @click="browse">先浏览商品</button>
      <text class="muted boundary">{{ globalCommerceNotice }}</text>
    </template>
  </view></view>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import DesktopHeader from "./DesktopHeader.vue";
import { api, mallOAuthSessionStamp, saveMallSession } from "../api";
import { brandLogo } from "../storefront";
import { globalCommerceNotice, mallStorage } from "../realm";
import { globalPageAllowed } from "../realm-config";
import { safeMallRoute } from "../commerce-model";
import { OAUTH_CONTEXT_KEY, OAUTH_TTL, OAUTH_CALLBACK_PATH, validGlobalIdentifier, validNewPassword, validOAuthContext, type OAuthContext } from "../global-auth-model";
import { takeGlobalOAuthCallback } from "../global-oauth";
import { loadGlobalLegal, legalPlainText, type GlobalLegalDocument } from "../global-legal";

type BindingMode = "password" | "email" | "sms";
type DocumentType = "userAgreement" | "privacyPolicy";
const capabilities = ref<any>(), documents = ref<Partial<Record<DocumentType, GlobalLegalDocument>>>({});
const identifier = ref(""), password = ref(""), code = ref(""), error = ref(""), busy = ref(false), loading = ref(true), accepted = ref(false), reading = ref<DocumentType | null>(null);
const bindTicket = ref(""), bindExpiresAt = ref(0), mode = ref<BindingMode>("password"), countdown = ref(0), codeNote = ref("");
const consent = ref({ version: "", locale: "en" }), challenge = ref<{ id: string; identifier: string; channel: string; expiresAt: number } | null>(null);
const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
const isWecom = /wxwork/i.test(userAgent), isWechat = /micromessenger/i.test(userAgent) && !isWecom;
const bindingModes: { key: BindingMode; label: string }[] = [{ key: "password", label: "已有账号" }, { key: "email", label: "邮箱验证" }, { key: "sms", label: "手机验证" }];
const legalReady = computed(() => !!consent.value.version && !!documents.value.userAgreement && !!documents.value.privacyPolicy);
const bindingEnabled = computed(() => capabilities.value?.login?.wechatBinding?.[mode.value]?.enabled === true);
const bindingReason = computed(() => capabilities.value?.login?.wechatBinding?.[mode.value]?.reason || "该验证方式尚未配置，请选择可用方式");
let active = true, timer: ReturnType<typeof setInterval> | undefined;
let bindingSession = "";
onBeforeUnmount(() => { active = false; if (timer) clearInterval(timer); password.value = ""; code.value = ""; bindTicket.value = ""; });
onMounted(() => { void initialize(true); });

async function loadCapabilities() {
  const caps: any = await api("/storefront/capabilities?locale=en");
  if (caps?.realm !== "global") throw new Error("当前入口未连接国际版服务，已停止登录");
  if (!active) return;
  capabilities.value = caps;
  documents.value = {}; consent.value = { version: "", locale: "en" }; accepted.value = false;
  if (!caps.consentVersion || !caps.legal?.userAgreement || !caps.legal?.privacyPolicy) return;
  const [terms, privacy] = await Promise.all([loadGlobalLegal(caps.legal.userAgreement), loadGlobalLegal(caps.legal.privacyPolicy)]);
  if (!active) return;
  if (terms.version !== caps.consentVersion || privacy.version !== terms.version || privacy.locale !== terms.locale) throw new Error("协议版本不一致，请稍后重试");
  documents.value = { userAgreement: terms, privacyPolicy: privacy };
  consent.value = { version: terms.version, locale: terms.locale };
}
async function initialize(handleCallback: boolean) {
  if (busy.value) return;
  loading.value = true; error.value = "";
  const callback = handleCallback ? takeGlobalOAuthCallback() : null;
  try {
    await loadCapabilities(); if (!active) return;
    if (callback?.error) throw new Error(callback.error);
    if (!callback?.code || !callback.context) return;
    const context = callback.context;
    if (!legalReady.value || context.consentVersion !== consent.value.version || context.locale !== consent.value.locale) throw new Error("协议已更新，请阅读并同意后重新发起微信授权");
    if (context.sessionStamp !== mallOAuthSessionStamp()) throw new Error("账号已切换，请重新授权");
    accepted.value = true; busy.value = true;
    const response: any = await api("/auth/wechat/h5/login", { method: "POST", data: { code: callback.code, state: context.state, codeVerifier: context.verifier, consentVersion: context.consentVersion, locale: context.locale } });
    if (!active) return;
    if (response.requiresAccountBinding || response.requiresMobileBinding) {
      if (typeof response.bindTicket !== "string" || !response.bindTicket || !Number.isFinite(response.expiresIn) || response.expiresIn <= 0) throw new Error("绑定响应无效，请重新授权");
      bindTicket.value = response.bindTicket; bindExpiresAt.value = Date.now() + Math.min(response.expiresIn * 1000, OAUTH_TTL);
      bindingSession = context.sessionStamp;
      mallStorage.set("saidian-post-login-route", safeMallRoute(response.returnTo || context.returnTo));
    } else await save(response);
  } catch (cause) { await showError(cause); }
  finally { if (active) { loading.value = false; busy.value = false; } }
}
function resetChallenge() { challenge.value = null; code.value = ""; codeNote.value = ""; }
function changeMode(next: BindingMode) { if (busy.value) return; mode.value = next; resetChallenge(); password.value = ""; error.value = ""; }
function requireBinding() {
  if (!bindTicket.value || Date.now() >= bindExpiresAt.value) { cancelBinding(); throw new Error("绑定凭证已过期，请重新微信授权"); }
  if (bindingSession !== mallOAuthSessionStamp()) { cancelBinding(); throw new Error("账号已切换，请重新微信授权"); }
  if (!bindingEnabled.value) throw new Error(bindingReason.value);
}
async function sendCode() {
  if (busy.value || countdown.value > 0 || mode.value === "password") return;
  busy.value = true; error.value = "";
  try {
    requireBinding();
    const recipient = identifier.value.trim(), channel = mode.value;
    if (!validGlobalIdentifier(recipient, channel)) throw new Error(channel === "email" ? "请输入正确邮箱" : "请输入含 +国家区号的国际手机号");
    const response: any = await api("/auth/wechat/h5/binding-code", { method: "POST", data: { bindTicket: bindTicket.value, channel, identifier: recipient, locale: consent.value.locale } });
    if (!active) return;
    if (!response.challengeId || !Number.isFinite(response.expiresIn) || response.expiresIn <= 0 || !Number.isFinite(response.retryAfter)) throw new Error("验证码响应不完整，请稍后重试");
    challenge.value = { id: response.challengeId, identifier: recipient, channel, expiresAt: Math.min(bindExpiresAt.value, Date.now() + response.expiresIn * 1000) };
    codeNote.value = "验证码已发送至 " + String(response.maskedIdentifier || "所填账号");
    countdown.value = Math.max(1, Math.ceil(response.retryAfter));
    if (timer) clearInterval(timer);
    timer = setInterval(() => { countdown.value = Math.max(0, countdown.value - 1); if (!countdown.value && timer) clearInterval(timer); }, 1000);
  } catch (cause) { await showError(cause); }
  finally { if (active) busy.value = false; }
}
async function login() {
  if (busy.value || loading.value) return;
  busy.value = true; error.value = "";
  try {
    if (!validGlobalIdentifier(identifier.value)) throw new Error("请输入邮箱或含 +国家区号的国际手机号");
    if (!password.value) throw new Error("请输入账号密码");
    let response: any;
    if (!bindTicket.value) {
      if (!capabilities.value?.login?.password?.enabled) throw new Error("密码登录暂不可用，请稍后重试");
      response = await api("/auth/password/login", { method: "POST", data: { mobile: identifier.value.trim(), password: password.value } });
    } else {
      requireBinding();
      if (!accepted.value || !legalReady.value) throw new Error("请先阅读并同意已发布的用户协议与隐私政策");
      const shared = { bindTicket: bindTicket.value, consentVersion: consent.value.version, locale: consent.value.locale };
      if (mode.value === "password") response = await api("/auth/wechat/h5/bind-account", { method: "POST", data: { ...shared, identifier: identifier.value.trim(), password: password.value } });
      else {
        const pending = challenge.value;
        if (!pending || pending.expiresAt <= Date.now() || pending.identifier !== identifier.value.trim() || pending.channel !== mode.value) throw new Error("请先获取当前账号的有效验证码");
        if (!/^\d{6}$/.test(code.value)) throw new Error("请输入 6 位验证码");
        if (!validNewPassword(password.value)) throw new Error("密码至少 8 个字符，且不能超过 72 个 UTF-8 字节");
        response = await api("/auth/wechat/h5/bind-code", { method: "POST", data: { ...shared, challengeId: pending.id, code: code.value, password: password.value } });
      }
    }
    if (active) await save(response);
  } catch (cause) { await showError(cause); }
  finally { if (active) busy.value = false; }
}
async function officialLogin() {
  if (busy.value || loading.value) return;
  busy.value = true; error.value = "";
  try {
    if (!isWechat) throw new Error("请在微信中打开页面进行公众号授权");
    if (!accepted.value || !legalReady.value) throw new Error("请阅读并同意当前用户协议与隐私政策");
    if (!capabilities.value?.login?.wechatH5?.enabled) throw new Error("微信公众号登录暂不可用");
    if (!crypto?.getRandomValues || !crypto.subtle) throw new Error("当前浏览器不支持安全授权，请使用新版微信和 HTTPS");
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    const challengeHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))), b => b.toString(16).padStart(2, "0")).join("");
    const requestSession = mallOAuthSessionStamp(), agreed = { ...consent.value };
    const returnTo = safeMallRoute(mallStorage.get("saidian-post-login-route"));
    const response: any = await api("/auth/wechat/h5/authorize-url", { method: "POST", data: { returnTo, codeChallenge: challengeHash, consentVersion: agreed.version, locale: agreed.locale } });
    if (!active) return;
    if (requestSession !== mallOAuthSessionStamp()) throw new Error("账号已切换，请重新授权");
    const destination = new URL(response.authorizeUrl);
    if (destination.protocol !== "https:" || destination.hostname !== "open.weixin.qq.com" || destination.pathname !== "/connect/oauth2/authorize" || destination.username || destination.password || destination.searchParams.get("state") !== response.state || destination.searchParams.get("redirect_uri") !== "https://app.saydian.cn" + OAUTH_CALLBACK_PATH) throw new Error("微信授权地址不属于国际版入口，已停止跳转");
    if (!Number.isFinite(response.expiresIn) || response.expiresIn <= 0) throw new Error("微信授权有效期无效");
    const context: OAuthContext = { state: response.state, verifier, consentVersion: agreed.version, locale: agreed.locale, expiresAt: Date.now() + Math.min(response.expiresIn * 1000, OAUTH_TTL), returnTo, sessionStamp: requestSession };
    if (!validOAuthContext(context, Date.now())) throw new Error("授权校验信息不完整");
    sessionStorage.setItem(OAUTH_CONTEXT_KEY, JSON.stringify(context));
    location.assign(destination.href);
  } catch (cause) { await showError(cause); }
  finally { if (active) busy.value = false; }
}
async function save(response: any) {
  if (!active) return;
  await saveMallSession(response);
  if (!active) return;
  const target = safeMallRoute(response.returnTo || mallStorage.get("saidian-post-login-route"));
  mallStorage.remove("saidian-post-login-route"); sessionStorage.removeItem(OAUTH_CONTEXT_KEY);
  password.value = ""; code.value = ""; bindTicket.value = "";
  uni.reLaunch({ url: globalPageAllowed(target) ? target : "/pages/profile/index" });
}
async function showError(cause: unknown) {
  if (!active) return;
  const key = (cause as any)?.errorKey;
  error.value = key === "account_verification_required" ? "该账号尚未验证邮箱或手机，不能仅凭密码绑定微信。请选择已开通的邮箱/手机验证码验证。" : cause instanceof Error ? cause.message : "请求失败，请重试";
  if (["consent_outdated", "consent_required", "legal_unavailable"].includes(key)) {
    cancelBinding(); accepted.value = false;
    try { await loadCapabilities(); } catch { /* Keep original contract error visible; consent stays disabled. */ }
  }
}
function cancelBinding() { bindTicket.value = ""; bindExpiresAt.value = 0; bindingSession = ""; resetChallenge(); password.value = ""; mode.value = "password"; accepted.value = false; }
function browse() { uni.switchTab({ url: "/pages/home/index" }); }
</script>
<style scoped>
.global-login{display:flex;justify-content:center;padding:28px 16px}.login-card{width:100%;max-width:520px;padding:28px;box-sizing:border-box}.logo{width:116px;height:46px;margin-bottom:20px}h1{font-size:24px;margin:0 0 12px}.muted{display:block;font-size:14px;line-height:1.7;color:#68717b;overflow-wrap:anywhere}.notice{font-size:14px;line-height:1.7;background:#fff7e5;padding:12px;margin-top:18px}.form-label{display:block;font-size:14px;margin:18px 0 8px}.input{height:46px;font-size:16px;margin-top:8px}.tabs{display:flex;gap:8px;margin:18px 0}.tabs button{flex:1;font-size:14px;padding:0 6px}.tabs .active{background:#e5f0ff;color:#005bad}.code-row{display:grid;grid-template-columns:minmax(0,1fr) 130px;gap:8px;margin-top:12px}.code-row button{padding:0 8px;font-size:14px}.code-row .input{margin:0}.agreement{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:14px;margin:22px 0;line-height:1.8}.text-button{font-size:14px;line-height:1.8;margin:14px auto 0;background:none;padding:0;color:#005bad}.agreement .text-button{margin:0}.wechat{margin-top:16px}.boundary{margin-top:20px;border-top:1px solid #e7e9ec;padding-top:16px}.legal-reader{margin-top:20px}.document{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.9;margin:20px 0}.error-state{overflow-wrap:anywhere}@media(max-width:420px){.login-card{padding:20px}.code-row{grid-template-columns:minmax(0,1fr) 118px}}
</style>
