<template>
  <view v-if="config" ref="root" :class="['app-download', variant === 'nav' ? 'download-nav' : 'download-mobile']">
    <button v-if="variant === 'nav'" class="download-nav-button" role="button" tabindex="0" @click="open">下载 APP</button>
    <view v-else class="download-card">
      <view class="app-icon"><image v-if="config.iconUrl && !iconFailed" :src="config.iconUrl" mode="aspectFit" @error="iconFailed = true" /><text v-else>S</text></view>
      <view class="download-copy"><text class="download-title">{{ config.title }}</text><text class="download-description">{{ config.description }}</text></view>
      <button class="download-action" role="button" tabindex="0" @click="open">去下载</button>
    </view>
    <view v-if="visible" class="download-overlay">
      <view class="download-backdrop" aria-hidden="true" @click="close" />
      <view ref="dialog" class="download-panel" role="dialog" aria-modal="true" aria-label="选择您的 APP" tabindex="-1">
        <view class="download-handle" /><view class="download-panel-heading"><text>选择您的 APP</text><button class="download-dismiss" role="button" tabindex="0" aria-label="关闭 APP 选择面板" @click="close">×</button></view>
        <text class="download-panel-description">根据您使用的设备，选择对应的官方 APP</text>
        <button class="download-choice" role="button" tabindex="0" @click="navigate(config.cnUrl)"><view class="app-icon">S</view><view><text class="choice-title">赛电中文</text><text class="choice-description">适用于兼容的赛电手表等设备</text></view><text class="choice-arrow">›</text></button>
        <button class="download-choice" role="button" tabindex="0" @click="navigate(config.ringUrl)"><view class="app-icon ring-icon">◯</view><view><text class="choice-title">赛电戒指 · Say Ring</text><text class="choice-description">适用于兼容的赛电智能戒指</text></view><text class="choice-arrow">›</text></button>
        <text class="download-hint">进入下载页后，请查看设备适配说明，选择手机系统对应版本。</text>
        <text v-if="wechat" class="wechat-hint">微信内如无法下载或打开应用商店，请点击右上角，选择在浏览器中打开。</text>
        <button class="international-link" role="button" tabindex="0" @click="navigate(config.internationalUrl)">需要国际版？查看赛电国际 ↗</button>
      </view>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { storefront } from "../storefront";
import { storeDownloadConfig } from "../app-download";
import { onHide } from "@dcloudio/uni-app";
const props = withDefaults(defineProps<{ variant?: "card" | "nav" }>(), { variant: "card" });
const config = computed(() => storefront.loaded ? storeDownloadConfig(storefront.configs) : null);
const visible = ref(false), iconFailed = ref(false), dialog = ref<any>(null), root = ref<any>(null);
const wechat = typeof navigator !== "undefined" && /micromessenger/i.test(navigator.userAgent);
let trigger: HTMLElement | null = null, previousOverflow = "", locked = false;
async function open() {
  if (!config.value || typeof document === "undefined" || visible.value) return;
  trigger = document.activeElement as HTMLElement | null;
  visible.value = true;
  previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; locked = true;
  await nextTick();
  const element = dialog.value?.$el || dialog.value;
  if (visible.value) element?.focus();
}
function close() {
  visible.value = false;
  if (locked) { document.body.style.overflow = previousOverflow; locked = false; }
  trigger?.focus(); trigger = null;
}
function activateButton(event: KeyboardEvent) {
  if (!["Enter", " "].includes(event.key)) return;
  const button = event.target as HTMLElement;
  if (button.getAttribute("role") === "button") { event.preventDefault(); button.click(); }
}
function keyDown(event: KeyboardEvent) {
  const element = (root.value?.$el || root.value) as HTMLElement | null;
  if (!visible.value && !element?.contains(event.target as Node)) return;
  activateButton(event);
  if (!visible.value) return;
  if (event.key === "Escape") { event.preventDefault(); close(); return; }
  if (event.key !== "Tab") return;
  const panel = (dialog.value?.$el || dialog.value) as HTMLElement | null;
  const buttons = panel?.querySelectorAll<HTMLElement>('button,[role="button"],a[href],[tabindex="0"]');
  if (!buttons?.length) return;
  const first = buttons[0]!, last = buttons[buttons.length - 1]!;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel || !panel?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}
function navigate(url: string) { close(); window.location.assign(url); }
watch(config, value => { iconFailed.value = false; if (!value) close(); });
onHide(close);
if (typeof document !== "undefined") document.addEventListener("keydown", keyDown);
onBeforeUnmount(() => { close(); if (typeof document !== "undefined") document.removeEventListener("keydown", keyDown); });
</script>
<style scoped>
button{margin:0;line-height:1.5}button::after{border:0}.download-nav{display:none}.download-card{margin:15px 0 18px;padding:12px 8px 12px 12px;display:flex;align-items:center;gap:10px;border:1px solid #dce7d4;border-radius:15px;background:linear-gradient(110deg,#edf3e5,#f5f8ed)}.app-icon{width:43px;height:43px;flex:none;border-radius:12px;background:#245e48;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;overflow:hidden}.app-icon image{width:100%;height:100%}.download-copy{flex:1;min-width:0}.download-title,.download-description{display:block;overflow-wrap:anywhere}.download-title{font-size:13px;font-weight:700;color:#172b28}.download-description{font-size:10px;color:#74816c;margin-top:3px}.download-action{padding:8px 12px;background:#245e48;color:white;border-radius:22px;font-size:12px;flex:none}.download-dismiss{background:transparent;color:#72866b;padding:7px;min-width:30px;font-size:22px;flex:none}.download-overlay{position:fixed;inset:0;background:rgba(19,36,27,.42);z-index:10000;display:flex;align-items:flex-end;justify-content:center}.download-panel{width:100%;max-height:90vh;overflow-y:auto;background:#fbfcf8;border-radius:25px 25px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));color:#172b28;outline:none;box-sizing:border-box;text-align:left}.download-handle{width:34px;height:4px;border-radius:3px;background:#d6ddd1;margin:0 auto 16px}.download-panel-heading{display:flex;align-items:center;justify-content:space-between;font-size:22px;font-weight:700}.download-panel-description{display:block;font-size:12px;color:#75866d;margin:6px 0 20px}.download-choice{display:flex;align-items:center;gap:12px;width:100%;padding:16px 12px;margin:10px 0;background:#fff;border:1px solid #e2e8db;border-radius:16px;text-align:left}.download-choice>view:nth-child(2){flex:1;min-width:0}.ring-icon{background:#252c31}.choice-title,.choice-description{display:block;overflow-wrap:anywhere}.choice-title{font-size:15px;font-weight:650;color:#172b28}.choice-description{font-size:11px;color:#7d8a73;margin-top:4px}.choice-arrow{margin-left:auto;color:#426b54;font-size:24px}.download-hint,.wechat-hint{display:block;padding:12px;background:#edf2e6;border-radius:10px;font-size:11px;color:#637755;line-height:1.8;margin-top:18px}.wechat-hint{background:#fff4da;color:#805e24;margin-top:8px}.international-link{display:block;background:transparent;color:#647b57;font-size:12px;margin:16px auto 0;padding:8px}.download-nav-button{background:transparent;font-size:14px;color:inherit;padding:0;line-height:44px}.download-choice:focus-visible,.download-action:focus-visible,.download-dismiss:focus-visible,.download-nav-button:focus-visible,.international-link:focus-visible{outline:2px solid #245e48;outline-offset:3px}@media(min-width:900px){.download-mobile{display:none}.download-nav{display:block}.download-overlay{align-items:center}.download-panel{width:440px;border-radius:24px;padding-bottom:24px}.download-handle{display:none}}
</style>
<style scoped>.download-backdrop{position:absolute;inset:0}.download-panel{position:relative}</style>
