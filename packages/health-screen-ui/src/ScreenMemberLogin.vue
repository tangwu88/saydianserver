<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { mallRoot, memberRoot, request } from "./member-access";
const navigatorUserAgent = navigator.userAgent;
const emit = defineEmits<{ login: [token: string] }>();
const mode = ref<"sms" | "qr">("sms"),
  phone = ref(""),
  code = ref(""),
  accepted = ref(false),
  busy = ref(false),
  error = ref(""),
  sentTo = ref(""),
  until = ref(0),
  now = ref(Date.now());
type Legal = { path: string; version: string; locale: string };
const challenge = ref<{ id: string; phone: string; expires: number } | null>(
    null,
  ),
  legalText = ref(""),
  legalTitle = ref("");
const caps = ref<{
  realm?: string;
  legal?: { userAgreement?: Legal; privacyPolicy?: Legal };
  login?: {
    sms?: { enabled: boolean; reason?: string };
    wechatH5?: { enabled: boolean; reason?: string };
  };
  consentVersion?: string;
} | null>(null);
type Qr = {
  poll: string;
  qr: string;
  scanUrl: string;
  match: string;
  expiresAt: string;
};
const qr = ref<Qr | null>(null),
  expired = ref(false),
  ready = ref(false),
  controller = new AbortController();
const legalReady = computed(
  () =>
    !!caps.value?.consentVersion &&
    (caps.value.realm !== "global" ||
      [caps.value.legal?.userAgreement, caps.value.legal?.privacyPolicy].every(
        (x) =>
          !!x &&
          x.version === caps.value?.consentVersion &&
          x.locale === caps.value?.legal?.userAgreement?.locale,
      )),
);
async function showLegal(k: "userAgreement" | "privacyPolicy") {
  const d = caps.value?.legal?.[k];
  if (!d) {
    window.open(
      "/global/saidian-mall/#/pages/help/index?section=" +
        (k === "userAgreement" ? "agreement" : "privacy"),
      "_blank",
      "noopener",
    );
    return;
  }
  try {
    if (
      !/^\/(global\/)?api\/saydian-app\/v2\/content\/legal\/[a-z_]+\?/.test(
        d.path,
      )
    )
      throw Error("协议链接无效");
    const doc = await request<{
      contentHtml: string;
      version: string;
      locale: string;
    }>(d.path, { signal: controller.signal });
    if (doc.version !== d.version || doc.locale !== d.locale)
      throw Error("协议已更新，请刷新");
    legalTitle.value = k === "userAgreement" ? "用户协议" : "隐私政策";
    const dom = new DOMParser().parseFromString(doc.contentHtml, "text/html");
    dom.querySelectorAll("script,style").forEach((e) => e.remove());
    legalText.value = dom.body.textContent || "";
  } catch (e) {
    error.value = message(e);
  }
}
const seconds = computed(() =>
  Math.max(0, Math.ceil((until.value - now.value) / 1000)),
);
let generation = 0,
  active = true,
  polling = false,
  timer: ReturnType<typeof setInterval>;
const message = (e: unknown) =>
  e instanceof Error ? e.message : "登录服务暂时不可用";
async function init() {
  error.value = "";
  try {
    const opt = await request<{ enabled: boolean }>(
      memberRoot + "/login/options",
      { signal: controller.signal },
    );
    if (!opt.enabled) throw Error("健康大屏尚未开放");
    caps.value = await request(
      mallRoot + "/storefront/capabilities?locale=zh-Hans",
      { signal: controller.signal },
    );
    ready.value = true;
    if (mode.value === "qr") void startQr();
  } catch (e) {
    if (active) error.value = message(e);
  }
}
function cancel() {
  const value = qr.value;
  qr.value = null;
  if (value)
    void request(memberRoot + "/login/qr/cancel", {
      data: { poll: value.poll },
    }).catch(() => {});
}
async function startQr() {
  const g = ++generation;
  cancel();
  expired.value = false;
  error.value = "";
  busy.value = true;
  try {
    const value = await request<Qr>(memberRoot + "/login/qr", {
      data: {},
      signal: controller.signal,
    });
    if (!active || generation !== g) {
      void request(memberRoot + "/login/qr/cancel", {
        data: { poll: value.poll },
      }).catch(() => {});
      return;
    }
    qr.value = value;
  } catch (e) {
    if (active && generation === g) error.value = message(e);
  } finally {
    if (g === generation) busy.value = false;
  }
}
function tab(next: "sms" | "qr") {
  if (mode.value === next) return;
  generation++;
  busy.value = false;
  cancel();
  error.value = "";
  mode.value = next;
  if (next === "qr" && ready.value) void startQr();
}
async function poll() {
  const q = qr.value,
    g = generation;
  if (!q || polling || document.hidden) return;
  if (Date.parse(q.expiresAt) <= Date.now()) {
    expired.value = true;
    cancel();
    return;
  }
  polling = true;
  try {
    const res = await request<{ status: string; token?: string }>(
      memberRoot + "/login/qr/result",
      { data: { poll: q.poll }, signal: controller.signal },
    );
    if (active && g === generation && res.token) {
      qr.value = null;
      emit("login", res.token);
    }
  } catch (e) {
    if (active && generation === g) {
      if ((e as any)?.response?.status === 410) {
        expired.value = true;
        cancel();
      } else error.value = message(e);
    }
  } finally {
    polling = false;
  }
}
async function sms(login: boolean) {
  if (busy.value) return;
  error.value = "";
  const n = phone.value.trim(),
    g = generation,
    global = caps.value?.realm === "global",
    recipient = global ? "+86" + n : n,
    locale = caps.value?.legal?.userAgreement?.locale || "zh-Hans";
  if (!/^1[3-9]\d{9}$/.test(n)) {
    error.value = "请输入11位手机号码";
    return;
  }
  if (
    login &&
    (!legalReady.value ||
      !accepted.value ||
      sentTo.value !== n ||
      !/^\d{6}$/.test(code.value))
  ) {
    error.value = "请核对手机号、6位验证码，并阅读同意协议";
    return;
  }
  busy.value = true;
  try {
    if (!login) {
      const res = await request<{
        retryAfter?: number;
        challengeId?: string;
        expiresIn?: number;
      }>(mallRoot + "/auth/code/request", {
        data: { channel: "sms", identifier: recipient, locale },
        signal: controller.signal,
      });
      if (active && g === generation) {
        if (global && (!res.challengeId || !res.expiresIn))
          throw Error("验证码暂不可用");
        challenge.value = res.challengeId
          ? {
              id: res.challengeId,
              phone: n,
              expires: Date.now() + Number(res.expiresIn) * 1000,
            }
          : null;
        sentTo.value = n;
        now.value = Date.now();
        until.value = now.value + (res.retryAfter || 60) * 1000;
      }
    } else {
      if (
        global &&
        (!challenge.value ||
          challenge.value.phone !== n ||
          challenge.value.expires <= Date.now())
      )
        throw Error("请重新获取验证码");
      const value = await request<{ accessToken?: string; token?: string }>(
        mallRoot + "/auth/code/login",
        {
          data: {
            channel: "sms",
            identifier: recipient,
            locale,
            challengeId: challenge.value?.id,
            code: code.value,
            consentVersion: caps.value?.consentVersion || "commerce-legal-v1",
          },
          signal: controller.signal,
        },
      );
      const token = value.accessToken || value.token;
      if (!token) throw Error("登录凭证已失效");
      const grant = await request<{ token: string }>(
        memberRoot + "/login/session",
        { token, data: {}, signal: controller.signal },
      );
      if (active && g === generation) emit("login", grant.token);
    }
  } catch (e) {
    if (active && g === generation) error.value = message(e);
  } finally {
    if (active && g === generation) busy.value = false;
  }
}
onMounted(() => {
  void init();
  timer = setInterval(() => {
    now.value = Date.now();
    if (mode.value === "qr") void poll();
  }, 2500);
});
onBeforeUnmount(() => {
  active = false;
  generation++;
  controller.abort();
  cancel();
  clearInterval(timer);
});
</script>
<template>
  <div class="screen-entry">
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-signin-title"
      class="entry-card"
    >
      <h1 id="screen-signin-title">会员登录</h1>
      <p>登录后查看本人的健康大屏。</p>
      <div class="entry-tabs">
        <button :aria-pressed="mode === 'sms'" @click="tab('sms')">
          手机验证码</button
        ><button :aria-pressed="mode === 'qr'" @click="tab('qr')">
          微信扫码
        </button>
      </div>
      <form v-if="mode === 'sms'" @submit.prevent="sms(true)">
        <label
          >手机号<input
            v-model="phone"
            type="tel"
            maxlength="11"
            autocomplete="tel-national"
            @input="
              code = '';
              sentTo = '';
              challenge = null;
            "
        /></label>
        <label
          >短信验证码<span class="entry-fields"
            ><input
              v-model="code"
              inputmode="numeric"
              maxlength="6"
              autocomplete="one-time-code"
            /><button
              type="button"
              :disabled="busy || seconds > 0 || !caps?.login?.sms?.enabled"
              @click="sms(false)"
            >
              {{ seconds ? seconds + " 秒后重发" : "获取验证码" }}
            </button></span
          ></label
        >
        <small v-if="sentTo && sentTo === phone"
          >验证码已发送至尾号 {{ phone.slice(-4) }} 的手机</small
        >
        <label class="entry-check"
          ><input v-model="accepted" type="checkbox" />我已阅读并同意
          <button
            type="button"
            class="legal-link"
            @click.prevent="showLegal('userAgreement')"
          >
            用户协议
          </button>
          和
          <button
            type="button"
            class="legal-link"
            @click.prevent="showLegal('privacyPolicy')"
          >
            隐私政策
          </button></label
        >
        <button
          class="entry-primary"
          :disabled="busy || !caps?.login?.sms?.enabled || !legalReady || !accepted || !phone || sentTo !== phone || !/^\d{6}$/.test(code)"
        >
          登录并查看
        </button>
        <p v-if="ready && !caps?.login?.sms?.enabled">
          {{ caps?.login?.sms?.reason || "短信登录暂不可用" }}
        </p>
      </form>
      <div v-else class="entry-qr">
        <template v-if="qr"
          ><img :src="qr.qr" alt="使用微信扫描登录大屏" /><strong
            >核对码 {{ qr.match }}</strong
          >
          <p>用微信扫码，在手机上核对并确认登录。</p>
          <a
            v-if="/micromessenger/i.test(navigatorUserAgent)"
            :href="qr.scanUrl"
            >在微信中确认</a
          ></template
        >
        <p v-else>
          {{
            expired
              ? "二维码已过期"
              : !ready
                ? "扫码服务暂不可用"
                : busy
                  ? "正在生成二维码"
                  : "等待扫码"
          }}
        </p>
        <button v-if="ready" :disabled="busy" @click="startQr">
          刷新二维码
        </button>
      </div>
      <div v-if="legalText" class="legal-panel">
        <h2>{{ legalTitle }}</h2>
        <p>{{ legalText }}</p>
        <button @click="legalText = ''">返回登录</button>
      </div>
      <p v-if="error" role="alert" class="entry-error">{{ error }}</p>
      <button v-if="!ready && error" @click="init">重试</button>
    </section>
  </div>
</template>
