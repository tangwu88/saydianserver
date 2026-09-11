<template>
  <DesktopHeader />
  <view class="saydian-app-surface auth-surface"><view class="auth-content">
    <BrandIdentity class="auth-brand" />
    <template v-if="reading">
      <h1>{{ reading === 'userAgreement' ? '用户协议' : '隐私政策' }}</h1>
      <text class="muted">版本 {{ documents[reading]?.version }}</text>
      <text class="document">{{ legalPlainText(documents[reading]?.contentHtml || '') }}</text>
      <button class="outline-btn" @click="reading = null">返回</button>
    </template>
    <template v-else>
      <h1>{{ bindTicket ? '绑定手机号' : '登录' }}</h1>
      <text v-if="bindTicket" class="muted step-note">微信授权完成，请填写手机号继续。</text>
      <view v-if="error" class="error-state" role="alert">{{ error }}</view>
      <text v-if="loading" class="muted">正在加载…</text>
      <button v-if="!loading && (!capabilities || !legalReady)" class="text-button retry" :disabled="busy" @click="initialize(false)">重新加载</button>
      <view v-if="!bindTicket" class="contact-tabs"><button :class="{active:contactMode==='email'}" :disabled="busy" @click="changeContact('email')">邮箱</button><button :class="{active:contactMode==='sms'}" :disabled="busy" @click="changeContact('sms')">手机号</button></view>
      <label class="field-label" :for="bindTicket ? 'bind-phone' : 'login-contact'">{{ bindTicket || contactMode === 'sms' ? '手机号' : '邮箱' }}</label>
      <input :id="bindTicket ? 'bind-phone' : 'login-contact'" v-model="identifier" :disabled="busy" class="input" maxlength="254" :placeholder="bindTicket || contactMode === 'sms' ? '含国家区号，如 +8613812345678' : '请输入邮箱'" @input="resetChallenge" />
      <template v-if="bindTicket">
        <view class="code-row"><input id="phone-code" v-model="code" :disabled="busy" class="input" type="number" maxlength="6" placeholder="6位验证码" aria-label="验证码"/><button class="text-button code-button" :disabled="busy || loading || countdown > 0 || !bindingEnabled" @click="sendCode">{{ countdown > 0 ? countdown + '秒后重试' : '获取验证码' }}</button></view>
        <text v-if="codeNote" class="muted code-note">{{ codeNote }}</text>
        <text v-if="!loading && !bindingEnabled" class="muted code-note">暂时无法获取验证码，请稍后再试。</text>
      </template>
      <template v-if="!bindTicket || passwordRequired">
        <label class="field-label" for="account-password">{{ bindTicket ? '原账号密码' : '密码' }}</label>
        <view class="password-field"><input id="account-password" v-model="password" :disabled="busy" :password="obscured" class="input" maxlength="72" :placeholder="bindTicket ? '请输入此手机号原账号的密码' : '请输入密码'" @confirm="login"/><button class="password-toggle" :disabled="busy" :aria-label="obscured ? '显示密码' : '隐藏密码'" @click="obscured = !obscured">{{ obscured ? '显示' : '隐藏' }}</button></view>
        <button class="text-button forgot" :disabled="busy" @click="forgotPassword">忘记密码？</button>
      </template>
      <view class="agreement"><checkbox-group @change="accepted = !!$event.detail.value.length"><label><checkbox value="yes" :checked="accepted" :disabled="busy || !legalReady" color="#d20b27"/>我已阅读并同意</label></checkbox-group><button class="text-button" :disabled="busy || !legalReady" @click="reading = 'userAgreement'">用户协议</button><text>和</text><button class="text-button" :disabled="busy || !legalReady" @click="reading = 'privacyPolicy'">隐私政策</button></view>
      <text v-if="!loading && !legalReady" class="muted code-note">协议暂时无法查看，请稍后重试。</text>
      <button class="primary-btn submit" :disabled="busy || loading || !legalReady || !capabilities || (bindTicket ? !bindingEnabled : !capabilities.login?.password?.enabled)" :loading="busy" @click="login">{{ bindTicket ? '确认并继续' : '登录' }}</button>
      <template v-if="!bindTicket">
        <view v-if="isWechat && capabilities?.login?.wechatH5?.enabled" class="wechat-section"><text class="separator">其他登录方式</text><button class="outline-btn wechat" :disabled="busy || loading || !legalReady" @click="officialLogin">微信登录</button></view>
        <text v-else-if="!isWechat && !isWecom" class="muted wechat-hint">在微信中打开，可使用微信登录。</text>
      </template>
      <button v-if="bindTicket" class="text-button back-login" :disabled="busy" @click="cancelBinding">返回登录</button>
      <button v-else class="text-button back-login" :disabled="busy" @click="browse">先逛逛</button>
    </template>
  </view></view>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import DesktopHeader from "./DesktopHeader.vue";
import BrandIdentity from "./BrandIdentity.vue";
import { api, mallOAuthSessionStamp, saveMallSession } from "../api";
import { mallStorage } from "../realm";
import { globalPageAllowed } from "../realm-config";
import { safeMallRoute } from "../commerce-model";
import { OAUTH_CONTEXT_KEY, OAUTH_TTL, OAUTH_CALLBACK_PATH, validGlobalIdentifier, validOAuthContext, type OAuthContext } from "../global-auth-model";
import { takeGlobalOAuthCallback } from "../global-oauth";
import { loadGlobalLegal, legalPlainText, type GlobalLegalDocument } from "../global-legal";
import { authErrorMessage, authUiError } from "../friendly-auth";
type DocumentType = "userAgreement" | "privacyPolicy";
const capabilities = ref<any>(), documents = ref<Partial<Record<DocumentType, GlobalLegalDocument>>>({});
const identifier = ref(""), password = ref(""), code = ref(""), error = ref(""), busy = ref(false), loading = ref(true), accepted = ref(false), reading = ref<DocumentType | null>(null);
const bindTicket = ref(""), bindExpiresAt = ref(0), contactMode = ref<"email" | "sms">("email"), countdown = ref(0), codeNote = ref(""), passwordRequired = ref(false), obscured = ref(true);
const consent = ref({ version: "", locale: "en" }), challenge = ref<{ id: string; identifier: string; expiresAt: number } | null>(null);
const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
const isWecom = /wxwork/i.test(userAgent), isWechat = /micromessenger/i.test(userAgent) && !isWecom;
const legalReady = computed(() => !!consent.value.version && !!documents.value.userAgreement && !!documents.value.privacyPolicy);
const bindingEnabled = computed(() => capabilities.value?.login?.wechatBinding?.phoneBindingAvailable === true && ["sms", "test"].includes(capabilities.value?.login?.wechatBinding?.phoneCodeMode));
let active = true, timer: ReturnType<typeof setInterval> | undefined, resendAt = 0;
let bindingSession = "";
onBeforeUnmount(() => { active = false; if (timer) clearInterval(timer); password.value = ""; code.value = ""; bindTicket.value = ""; });
onMounted(() => { void initialize(true); });
async function loadCapabilities() {
  const caps: any = await api("/storefront/capabilities?locale=en");
  if (caps?.realm !== "global") throw authUiError("登录暂时无法使用，请稍后重试。");
  if (!active) return;
  capabilities.value = caps;
  documents.value = {}; consent.value = { version: "", locale: "en" }; accepted.value = false;
  if (!caps.consentVersion || !caps.legal?.userAgreement || !caps.legal?.privacyPolicy) return;
  const [terms, privacy] = await Promise.all([loadGlobalLegal(caps.legal.userAgreement), loadGlobalLegal(caps.legal.privacyPolicy)]);
  if (!active) return;
  if (terms.version !== caps.consentVersion || privacy.version !== terms.version || privacy.locale !== terms.locale) throw authUiError("协议已更新，请刷新后重试。");
  documents.value = { userAgreement: terms, privacyPolicy: privacy }; consent.value = { version: terms.version, locale: terms.locale };
}
async function initialize(handleCallback: boolean) {
  if (busy.value) return;
  loading.value = true; error.value = "";
  const callback = handleCallback ? takeGlobalOAuthCallback() : null;
  try {
    await loadCapabilities(); if (!active) return;
    if (callback?.error) throw authUiError(callback.error);
    if (!callback?.code || !callback.context) return;
    const context = callback.context;
    if (!legalReady.value || context.consentVersion !== consent.value.version || context.locale !== consent.value.locale) throw authUiError("协议已更新，请阅读并同意后重新微信登录。");
    if (context.sessionStamp !== mallOAuthSessionStamp()) throw authUiError("账号已切换，请重新登录。");
    accepted.value = true; busy.value = true;
    const response: any = await api("/auth/wechat/h5/login", { method: "POST", data: { code: callback.code, state: context.state, codeVerifier: context.verifier, consentVersion: context.consentVersion, locale: context.locale } });
    if (!active) return;
    if (response.requiresPhoneBinding || response.requiresAccountBinding || response.requiresMobileBinding) {
      if (typeof response.bindTicket !== "string" || !response.bindTicket || !Number.isFinite(response.expiresIn) || response.expiresIn <= 0) throw authUiError("微信登录未完成，请重新试一次。");
      bindTicket.value = response.bindTicket; bindExpiresAt.value = Date.now() + Math.min(response.expiresIn * 1000, OAUTH_TTL);
      bindingSession = context.sessionStamp; identifier.value = ""; password.value = ""; passwordRequired.value = false;
      mallStorage.set("saidian-post-login-route", safeMallRoute(response.returnTo || context.returnTo));
    } else await save(response);
  } catch (cause) { await showError(cause); }
  finally { if (active) { loading.value = false; busy.value = false; } }
}
function resetChallenge() { challenge.value = null; code.value = ""; codeNote.value = ""; password.value = ""; passwordRequired.value = false; }
function changeContact(next: "email" | "sms") { if (busy.value) return; contactMode.value = next; identifier.value = ""; resetChallenge(); error.value = ""; }
function requireBinding() {
  if (!bindTicket.value || Date.now() >= bindExpiresAt.value) { cancelBinding(); throw authUiError("微信登录已过期，请重新登录。"); }
  if (bindingSession !== mallOAuthSessionStamp()) { cancelBinding(); throw authUiError("账号已切换，请重新登录。"); }
  if (!bindingEnabled.value) throw authUiError("暂时无法获取验证码，请稍后再试。");
}
async function sendCode() {
  if (busy.value || countdown.value > 0) return;
  busy.value = true; error.value = "";
  try {
    requireBinding();
    const recipient = identifier.value.trim();
    if (!validGlobalIdentifier(recipient, "sms")) throw authUiError("请检查国家区号和手机号。");
    const response: any = await api("/auth/wechat/h5/phone-code", { method: "POST", data: { bindTicket: bindTicket.value, identifier: recipient, locale: consent.value.locale } });
    if (!active) return;
    if (!response.challengeId || !Number.isFinite(response.expiresIn) || response.expiresIn <= 0 || !Number.isFinite(response.retryAfter) || !["sms", "test"].includes(response.mode)) throw authUiError("验证码暂时无法使用，请稍后重试。");
    if ((response.mode === "sms" && (response.sent !== true || response.verificationRequired !== true)) || (response.mode === "test" && (response.sent !== false || response.verificationRequired !== false))) throw authUiError("验证码暂时无法使用，请稍后重试。");
    challenge.value = { id: response.challengeId, identifier: recipient, expiresAt: Math.min(bindExpiresAt.value, Date.now() + response.expiresIn * 1000) };
    passwordRequired.value = false; password.value = "";
    codeNote.value = response.sent === true ? "验证码已发送至 " + String(response.maskedIdentifier || "所填手机号") : "请填写6位验证码";
    resendAt = Date.now() + Math.max(1, Math.min(86400, Math.ceil(response.retryAfter))) * 1000;
    countdown.value = Math.ceil((resendAt - Date.now()) / 1000);
    if (timer) clearInterval(timer);
    timer = setInterval(() => { countdown.value = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)); if (!countdown.value && timer) clearInterval(timer); }, 1000);
  } catch (cause) { await showError(cause); }
  finally { if (active) busy.value = false; }
}
async function login() {
  if (busy.value || loading.value) return;
  busy.value = true; error.value = "";
  try {
    if (!accepted.value || !legalReady.value) throw authUiError("请先阅读并同意用户协议与隐私政策。");
    if (!validGlobalIdentifier(identifier.value, bindTicket.value ? "sms" : contactMode.value)) throw authUiError(bindTicket.value || contactMode.value === "sms" ? "请检查国家区号和手机号。" : "请输入正确的邮箱地址。");
    let response: any;
    if (!bindTicket.value) {
      if (!password.value) throw authUiError("请输入密码。");
      if (!capabilities.value?.login?.password?.enabled) throw authUiError("登录暂时无法使用，请稍后重试。");
      response = await api("/auth/password/login", { method: "POST", data: { mobile: identifier.value.trim(), password: password.value } });
    } else {
      requireBinding();
      const pending = challenge.value;
      if (!pending || pending.expiresAt <= Date.now() || pending.identifier !== identifier.value.trim()) throw authUiError("请先获取当前手机号的验证码。");
      if (!/^\d{6}$/.test(code.value)) throw authUiError("请输入6位验证码。");
      if (passwordRequired.value && !password.value) throw authUiError("请输入该手机号原账号的密码。");
      response = await api("/auth/wechat/h5/bind-phone", { method: "POST", data: { bindTicket: bindTicket.value, challengeId: pending.id, code: code.value, consentVersion: consent.value.version, locale: consent.value.locale, ...(passwordRequired.value ? { password: password.value } : {}) } });
    }
    if (active) await save(response);
  } catch (cause) { await showError(cause); }
  finally { if (active) busy.value = false; }
}
async function officialLogin() {
  if (busy.value || loading.value) return;
  busy.value = true; error.value = "";
  try {
    if (!isWechat) throw authUiError("请在微信中打开后重试。");
    if (!accepted.value || !legalReady.value) throw authUiError("请先阅读并同意用户协议与隐私政策。");
    if (!capabilities.value?.login?.wechatH5?.enabled) throw authUiError("微信登录暂时无法使用，请稍后重试。");
    if (!crypto?.getRandomValues || !crypto.subtle) throw authUiError("请使用新版微信重新打开页面。");
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    const challengeHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))), b => b.toString(16).padStart(2, "0")).join("");
    const requestSession = mallOAuthSessionStamp(), agreed = { ...consent.value };
    const returnTo = safeMallRoute(mallStorage.get("saidian-post-login-route"));
    const response: any = await api("/auth/wechat/h5/authorize-url", { method: "POST", data: { returnTo, codeChallenge: challengeHash, consentVersion: agreed.version, locale: agreed.locale } });
    if (!active) return;
    if (requestSession !== mallOAuthSessionStamp()) throw authUiError("账号已切换，请重新登录。");
    const destination = new URL(response.authorizeUrl);
    if (destination.protocol !== "https:" || destination.hostname !== "open.weixin.qq.com" || destination.pathname !== "/connect/oauth2/authorize" || destination.username || destination.password || destination.searchParams.get("state") !== response.state || destination.searchParams.get("redirect_uri") !== "https://app.saydian.cn" + OAUTH_CALLBACK_PATH) throw authUiError("微信登录暂时无法使用，请稍后重试。");
    if (!Number.isFinite(response.expiresIn) || response.expiresIn <= 0) throw authUiError("微信登录已过期，请重试。");
    const context: OAuthContext = { state: response.state, verifier, consentVersion: agreed.version, locale: agreed.locale, expiresAt: Date.now() + Math.min(response.expiresIn * 1000, OAUTH_TTL), returnTo, sessionStamp: requestSession };
    if (!validOAuthContext(context, Date.now())) throw authUiError("微信登录暂时无法使用，请稍后重试。");
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
  if (key === "phone_password_required" && bindTicket.value && challenge.value) passwordRequired.value = true;
  const message = authErrorMessage(cause);
  if (["consent_outdated", "consent_required", "legal_unavailable"].includes(key)) {
    cancelBinding(); accepted.value = false;
    try { await loadCapabilities(); } catch { /* Original friendly consent error stays visible. */ }
  }
  if (active) error.value = message;
}
function cancelBinding() { bindTicket.value = ""; bindExpiresAt.value = 0; bindingSession = ""; resetChallenge(); identifier.value = ""; accepted.value = false; error.value = ""; }
function forgotPassword() { uni.showModal({ title: "找回密码", content: "请打开 Saydian App，在登录页选择“忘记密码”找回。", showCancel: false }); }
function browse() { uni.switchTab({ url: "/pages/home/index" }); }
</script>
<style lang="scss">@import "../global-ui.scss";</style>
<style scoped>
.auth-surface{padding-top:40px}.auth-content{width:100%;max-width:432px;margin:0 auto}.auth-brand{margin:0 auto 32px}.auth-content h1{margin-bottom:20px}.step-note{margin:-8px 0 22px}.field-label{display:block;font-size:14px;font-weight:600;margin:18px 0 8px;color:#5f6675}.input{width:100%;height:54px;border:1px solid #98a2b3;border-radius:12px;background:#fff;padding:0 16px;color:#171b2b;font-size:16px;box-sizing:border-box}.input:focus-within{border-color:#d20b27}.contact-tabs{display:flex;gap:8px;margin-bottom:18px}.contact-tabs button{font-size:15px;line-height:1.5;font-weight:600;padding:10px 18px;border:1px solid #dde3ec;border-radius:10px;margin:0;background:#fff;color:#171b2b}.contact-tabs .active{background:#fff6de;border-color:#fff6de}.password-field{position:relative}.password-field .input{padding-right:62px}.password-toggle{position:absolute;right:3px;top:3px;bottom:3px;min-width:54px;padding:0 8px;margin:0;font-size:13px;line-height:48px;color:#5f6675;background:transparent}.forgot{display:block;margin:4px 0 0 auto;text-align:right}.agreement{display:flex;flex-wrap:wrap;align-items:center;column-gap:5px;row-gap:0;font-size:12px;line-height:1.6;margin:20px 0 14px;color:#5f6675}.agreement label{display:flex;align-items:center;gap:3px}.agreement checkbox{transform:scale(.8);transform-origin:left center;width:25px}.agreement .text-button{margin:0;font-size:12px;padding:8px 0;min-height:36px}.submit{width:100%}.wechat-section{margin-top:24px}.separator{display:block;color:#98a2b3;text-align:center;font-size:12px;margin-bottom:16px}.wechat{width:70%;margin:0 auto;color:#07883e;border-color:#ccd6d0}.wechat-hint{text-align:center;margin:20px 0 0;font-size:12px}.code-row{display:grid;grid-template-columns:minmax(0,1fr) 116px;align-items:center;gap:10px;margin-top:16px}.code-button{white-space:nowrap;font-size:14px}.code-note{margin:10px 0;font-size:13px}.back-login{margin:18px auto 0}.retry{margin:0 0 12px}.document{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.9;margin:20px 0}@media(min-width:900px){.auth-surface{padding-top:48px}.auth-content{max-width:432px}}@media(max-width:360px){.auth-surface{padding:28px 18px 40px}.code-row{grid-template-columns:minmax(0,1fr) 104px;gap:6px}}
</style>
