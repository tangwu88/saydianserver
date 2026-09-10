<template><DesktopHeader /><view class="page"><view class="container card global-help"><h1>国际版协议与服务</h1><p>{{ globalCommerceNotice }}</p><p>本入口不展示国内版订单、积分或客服配置。国际交易与员工服务尚未开放。</p><view class="tabs"><button :class="{active:section==='userAgreement'}" @click="section='userAgreement'">用户协议</button><button :class="{active:section==='privacyPolicy'}" @click="section='privacyPolicy'">隐私政策</button></view><text v-if="loading">正在读取已审核的国际版协议…</text><view v-else-if="error" class="error-state">{{ error }}<button class="outline-btn" @click="load">重新加载</button></view><template v-else-if="document"><h2>{{ section==='userAgreement'?'用户协议':'隐私政策' }}</h2><text class="small">版本 {{ document.version }} · {{ document.locale }}</text><text class="legal-text">{{ legalPlainText(document.contentHtml) }}</text></template></view></view></template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api";
import { globalCommerceNotice } from "../realm";
import { legalPlainText, loadGlobalLegal, type GlobalLegalDocument } from "../global-legal";
import DesktopHeader from "./DesktopHeader.vue";
const props = defineProps<{ initialSection?: string }>();
const section = ref(props.initialSection === "privacy" ? "privacyPolicy" : "userAgreement");
const rows = ref<Record<string, GlobalLegalDocument>>({}), loading = ref(false), error = ref("");
const document = computed(() => rows.value[section.value]);
let active = true;
onBeforeUnmount(() => { active = false; });
onMounted(load);
async function load() {
  if (loading.value) return;
  loading.value = true; error.value = "";
  try {
    const caps: any = await api("/storefront/capabilities?locale=en");
    if (caps.realm !== "global" || !caps.consentVersion || !caps.legal?.userAgreement || !caps.legal?.privacyPolicy) throw new Error("国际版已审核协议尚未发布，请稍后再试");
    const [terms, privacy] = await Promise.all([loadGlobalLegal(caps.legal.userAgreement), loadGlobalLegal(caps.legal.privacyPolicy)]);
    if (terms.version !== caps.consentVersion || privacy.version !== terms.version || privacy.locale !== terms.locale) throw new Error("协议版本不一致，暂不能展示");
    if (active) rows.value = { userAgreement: terms, privacyPolicy: privacy };
  } catch (cause) { if (active) { rows.value = {}; error.value = cause instanceof Error ? cause.message : "读取失败，请重试"; } }
  finally { if (active) loading.value = false; }
}
</script>
<style scoped>.global-help{max-width:900px;box-sizing:border-box;overflow-wrap:anywhere}.global-help h1{font-size:24px}.global-help h2{font-size:20px}.global-help p{font-size:14px;line-height:1.8;color:#606b78}.tabs{display:flex;gap:12px;margin:24px 0}.tabs button{font-size:14px;margin:0}.tabs .active{color:#005bad;background:#eaf2fc}.legal-text{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.9;margin:20px 0}</style>
