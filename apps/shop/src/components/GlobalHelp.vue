<template><DesktopHeader /><view class="saydian-app-surface"><view class="help-content"><view class="help-top"><button class="text-button" @click="back">‹ 返回</button><h1>协议与隐私</h1></view><view class="tabs"><button :class="{active:section==='userAgreement'}" @click="section='userAgreement'">用户协议</button><button :class="{active:section==='privacyPolicy'}" @click="section='privacyPolicy'">隐私政策</button></view><text v-if="loading" class="muted">正在加载…</text><view v-else-if="error" class="error-state">{{ error }}<button class="outline-btn" @click="load">重试</button></view><view v-else-if="document" class="app-panel"><h2>{{ section==='userAgreement'?'用户协议':'隐私政策' }}</h2><text class="muted version">版本 {{ document.version }}</text><text class="legal-text">{{ legalPlainText(document.contentHtml) }}</text></view></view></view></template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api";
import { authErrorMessage, authUiError } from "../friendly-auth";
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
    if (caps.realm !== "global" || !caps.consentVersion || !caps.legal?.userAgreement || !caps.legal?.privacyPolicy) throw authUiError("协议暂时无法查看，请稍后重试。");
    const [terms, privacy] = await Promise.all([loadGlobalLegal(caps.legal.userAgreement), loadGlobalLegal(caps.legal.privacyPolicy)]);
    if (terms.version !== caps.consentVersion || privacy.version !== terms.version || privacy.locale !== terms.locale) throw authUiError("协议已更新，请刷新后查看。");
    if (active) rows.value = { userAgreement: terms, privacyPolicy: privacy };
  } catch (cause) { if (active) { rows.value = {}; error.value = authErrorMessage(cause, "协议暂时无法查看，请稍后重试。"); } }
  finally { if (active) loading.value = false; }
}
function back() { const pages = getCurrentPages(); if (pages.length > 1) uni.navigateBack(); else uni.switchTab({ url: "/pages/profile/index" }); }
</script>
<style lang="scss">@import "../global-ui.scss";</style>
<style scoped>.help-content{max-width:800px;margin:0 auto;overflow-wrap:anywhere}.help-top{display:flex;align-items:center;gap:18px;margin-bottom:20px}.help-top h1{font-size:20px;margin:0;flex:1}.help-top button{margin:0}.tabs{display:flex;gap:10px;margin-bottom:20px}.tabs button{font-size:14px;padding:10px 16px;line-height:1.5;margin:0;border-radius:10px;border:1px solid #dde3ec;color:#171b2b;background:white}.tabs .active{color:#980018;background:#ffe8ec;border-color:#ffd0d9}.version{margin-top:8px}.legal-text{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.9;margin-top:20px}</style>
