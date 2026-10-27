<template>
  <GlobalHelp v-if="['agreement', 'privacy'].includes(active)" :key="active" :initial-section="active" />
  <template v-else>
    <DesktopHeader />
    <view class="page help-page">
      <view class="container help-layout">
        <view class="card nav" role="navigation" aria-label="帮助与服务">
          <button role="button" v-for="item in sections" :key="item.key" :class="active === item.key && 'active'" :aria-current="active === item.key ? 'page' : 'false'" @click="selectSection(item.key)">{{ item.label }}</button>
        </view>
        <view :class="active === 'service' ? 'service-content' : 'card content'">
          <view v-if="error" class="error-state" role="alert">{{ error }}<button class="text-button" @click="loadSupport">重试</button></view>
          <template v-if="active === 'service'">
            <view class="service-heading">
              <view class="heading-icon" aria-hidden="true"><view class="service-icon icon-headset" /></view>
              <view><h1>赛电客服</h1><text>{{ officialSupport.hours }}</text></view>
            </view>
            <view class="contact-options">
              <view class="card contact-card online-card">
                <view class="contact-label"><view class="icon-wrap" aria-hidden="true"><view class="service-icon icon-chat" /></view><h2>在线客服</h2></view>
                <strong class="contact-title">企业微信客服</strong>
                <text class="contact-note">发送文字或图片，说明您遇到的问题。</text>
                <button role="button" class="primary-btn" :disabled="!service.wecomUrl" @click="openService">{{ service.wecomUrl ? '联系在线客服' : '在线客服暂不可用' }}<text aria-hidden="true">↗</text></button>
              </view>
              <view class="card contact-card">
                <view class="contact-label"><view class="icon-wrap" aria-hidden="true"><view class="service-icon icon-phone" /></view><h2>电话客服</h2></view>
                <strong class="contact-title phone-number">{{ servicePhoneLabel || '暂未提供电话' }}</strong>
                <text class="contact-note">咨询订单、产品使用及售后问题。</text>
                <view class="phone-actions"><button role="button" class="outline-btn" :disabled="!service.phone" @click="callService">拨打客服</button><button role="button" class="copy-phone" :disabled="!service.phone" @click="copyPhone">复制号码</button></view>
              </view>
            </view>
            <view class="card service-shortcuts">
              <h2>订单与售后</h2>
              <view class="shortcut-list">
                <button role="button" class="service-shortcut" @click="orders"><view class="shortcut-icon" aria-hidden="true"><view class="service-icon icon-box" /></view><view><b>我的订单</b><text>查看订单与物流，申请售后</text></view><text class="shortcut-arrow" aria-hidden="true">›</text></button>
                <button role="button" class="service-shortcut" @click="selectSection('feedback')"><view class="shortcut-icon" aria-hidden="true"><view class="service-icon icon-message" /></view><view><b>问题反馈</b><text>提交问题，查看客服回复</text></view><text class="shortcut-arrow" aria-hidden="true">›</text></button>
                <button role="button" class="service-shortcut" @click="selectSection('afterSale')"><view class="shortcut-icon" aria-hidden="true"><view class="service-icon icon-document" /></view><view><b>售后政策</b><text>了解售后规则与办理流程</text></view><text class="shortcut-arrow" aria-hidden="true">›</text></button>
              </view>
            </view>
            <view class="card service-questions">
              <h2>常见问题</h2>
              <view v-for="item in questions" :key="item.key" class="service-question">
                <button role="button" :aria-expanded="openQuestion === item.key" @click="openQuestion = openQuestion === item.key ? '' : item.key"><text>{{ item.title }}</text><text :class="['question-toggle', openQuestion === item.key && 'expanded']" aria-hidden="true">＋</text></button>
                <view v-if="openQuestion === item.key" class="question-answer"><text>{{ item.answer }}</text><button v-if="item.key === 'device'" role="button" class="text-button" @click="openOfficial(officialSupport.support)">查看使用指引 ↗</button></view>
              </view>
            </view>
          </template>
          <template v-else-if="active === 'feedback'">
            <h2>问题反馈</h2>
            <p class="intro">请简要说明遇到的问题。客服回复后，可直接在本页查看。</p>
            <view class="feedback-form">
              <label>问题类型<picker :range="feedbackLabels" :value="feedbackIndex" :disabled="submittingFeedback" @change="feedbackIndex = Number($event.detail.value)"><view class="input picker-field">{{ feedbackLabels[feedbackIndex] }} ›</view></picker></label>
              <label>问题说明<textarea v-model="feedbackContent" class="textarea" maxlength="2000" :disabled="submittingFeedback" placeholder="请描述发生了什么，以及希望我们如何协助" /></label>
              <label>联系方式（选填）<input v-model="feedbackContact" class="input" maxlength="100" :disabled="submittingFeedback" placeholder="手机号或邮箱，便于客服联系" /></label>
              <button class="primary-btn" :loading="submittingFeedback" :disabled="submittingFeedback || feedbackContent.trim().length < 5" @click="submitFeedback">提交反馈</button>
            </view>
            <view class="feedback-history-heading"><h3>我的反馈</h3><button class="text-button" :disabled="feedbackLoading" @click="loadFeedback">刷新</button></view>
            <view v-if="feedbackLoading" class="empty">正在读取反馈…</view>
            <view v-else-if="!feedbackRows.length" class="empty">暂无反馈记录</view>
            <article v-for="item in feedbackRows" v-else :key="item.id" class="feedback-item">
              <view class="feedback-meta"><b>{{ feedbackTypeLabel(item.category) }}</b><text>{{ feedbackStatusLabel(item.status) }} · {{ dateTime(item.createdAt) }}</text></view>
              <p>{{ item.content }}</p>
              <view v-if="item.replyContent" class="reply"><b>客服回复</b><p>{{ item.replyContent }}</p><text v-if="item.repliedAt">{{ dateTime(item.repliedAt) }}</text></view>
              <view v-else class="waiting-reply">客服正在处理，请稍后查看</view>
            </article>
          </template>
          <template v-else-if="active === 'afterSale'">
            <h2>售后政策</h2><button class="outline-btn" @click="openOfficial(officialSupport.afterSale)">查看官网售后指引</button><rich-text v-if="policies.afterSale" :nodes="policies.afterSale" /><p v-else>您可在订单详情中提交售后申请并查看进度，也可联系官方客服确认商品的售后规则。</p>
          </template>
          <template v-else-if="active === 'privacy'">
            <h2>隐私政策</h2><rich-text v-if="policies.privacy" :nodes="policies.privacy" /><p v-else>隐私政策暂时无法查看，请稍后重试。</p>
          </template>
          <template v-else-if="active === 'agreement'">
            <h2>用户协议</h2><rich-text v-if="policies.service" :nodes="policies.service" /><p v-else>用户协议暂时无法查看，请稍后重试。</p>
          </template>
        </view>
      </view>
    </view>
  </template>
</template>

<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { computed, reactive, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import GlobalHelp from "../../components/GlobalHelp.vue";
import { api, requireLogin, toast } from "../../api";
import { officialSupport, openOfficial } from "../../official-support";
import { isGlobalMall } from "../../realm";

const error = ref("");
const active = ref("service");
const service = reactive<any>({phone:officialSupport.phone,wecomUrl:officialSupport.wecomUrl});
const servicePhoneLabel = computed(() => String(service.phone || '') === officialSupport.phone ? officialSupport.phoneLabel : String(service.phone || ''));
const openQuestion = ref('');
const questions = [
  { key: 'delivery', title: '在哪里查看发货和物流？', answer: '进入“我的订单”，打开对应订单详情，即可查看发货状态、运单号及已同步的物流信息。' },
  { key: 'afterSale', title: '如何申请退换货？', answer: '打开对应订单详情，选择“申请售后”，按提示填写申请。已提交的申请可在订单中继续查看处理进度。' },
  { key: 'device', title: '设备连接或使用遇到问题怎么办？', answer: '先查看产品使用指引；如仍需帮助，可通过在线客服发送设备型号、问题描述和相关截图。' },
];
const policies = reactive<any>({});
const feedbackContent = ref("");
const feedbackContact = ref("");
const feedbackIndex = ref(0);
const feedbackRows = ref<any[]>([]);
const feedbackLoading = ref(false);
const submittingFeedback = ref(false);
const feedbackTypes = [
  { key: "shopping", label: "购物与订单" },
  { key: "after_sale", label: "售后与退款" },
  { key: "account", label: "账号与登录" },
  { key: "product", label: "商品建议" },
  { key: "other", label: "其他问题" },
];
const feedbackLabels = feedbackTypes.map(item => item.label);
const sections = [
  { key: "service", label: "联系客服" },
  { key: "feedback", label: "问题反馈" },
  { key: "afterSale", label: "售后政策" },
  { key: "privacy", label: "隐私政策" },
  { key: "agreement", label: "用户协议" },
];

onLoad(async options => {
  const section = options?.section === "terms" ? "agreement" : options?.section;
  active.value = sections.some(item => item.key === section) ? String(section) : "service";
  if (isGlobalMall && ["agreement", "privacy"].includes(active.value)) return;
  await loadSupport();
  if (active.value === "feedback") await loadFeedback();
});

async function selectSection(section: string): Promise<void> {
  active.value = section;
  if (section === "feedback" && !feedbackRows.value.length) await loadFeedback();
}

async function loadSupport(): Promise<void> {
  error.value = "";
  try {
    const result: any = await api("/storefront/bootstrap");
    Object.assign(service, result.configs?.["customer.service"]?.enabled ? result.configs["customer.service"].value : {});
    Object.assign(policies, result.configs?.policies?.enabled ? result.configs.policies.value : {});
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "服务信息暂时无法加载";
  }
}

async function loadFeedback(): Promise<void> {
  if (!requireLogin("/pages/help/index?section=feedback") || feedbackLoading.value) return;
  feedbackLoading.value = true;
  try {
    const rows = await api<any[]>("/storefront/feedback", { auth: true });
    feedbackRows.value = Array.isArray(rows) ? rows : [];
  } catch {
    toast("反馈记录暂时无法加载，请稍后重试");
  } finally {
    feedbackLoading.value = false;
  }
}

async function submitFeedback(): Promise<void> {
  if (!requireLogin("/pages/help/index?section=feedback") || submittingFeedback.value) return;
  const content = feedbackContent.value.trim();
  if (content.length < 5) return toast("请填写至少5个字的问题说明");
  submittingFeedback.value = true;
  try {
    await api("/storefront/feedback", {
      method: "POST",
      auth: true,
      data: { category: feedbackTypes[feedbackIndex.value]?.key ?? "other", content, contact: feedbackContact.value.trim() },
    });
    feedbackContent.value = "";
    feedbackContact.value = "";
    toast("反馈已提交");
    await loadFeedback();
  } catch {
    toast("反馈暂时无法提交，请稍后重试");
  } finally {
    submittingFeedback.value = false;
  }
}

function feedbackTypeLabel(value: unknown): string { return feedbackTypes.find(item => item.key === value)?.label ?? "其他问题"; }
function feedbackStatusLabel(value: unknown): string { return ({ open: "待处理", in_progress: "处理中", resolved: "已回复", closed: "已关闭" } as Record<string, string>)[String(value).toLowerCase()] ?? "处理中"; }
function dateTime(value: unknown): string { const date = value ? new Date(String(value)) : null; return date && Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "时间未获取"; }
function orders(): void { uni.navigateTo({ url: "/pages/orders/index" }); }
function callService(): void { if (/^[+\d -]{5,30}$/.test(String(service.phone))) uni.makePhoneCall({ phoneNumber: String(service.phone) }); else toast("电话暂时无法拨打，请使用在线客服"); }
function copyPhone(): void { if (/^[+\d -]{5,30}$/.test(String(service.phone))) uni.setClipboardData({ data: String(service.phone) }); else toast("电话号码暂不可用，请使用在线客服"); }
function openService(): void {
  try {
    const target = String(service.wecomUrl);
    if (!/^https:\/\/work\.weixin\.qq\.com\//.test(target) || /[\\\s]/.test(target)) throw new Error("在线客服暂时无法打开，请拨打客服电话");
    /* #ifdef H5 */
    location.assign(target);
    /* #endif */
    /* #ifndef H5 */
    uni.setClipboardData({ data: target });
    /* #endif */
  } catch (cause) { toast(cause); }
}
</script>

<style scoped lang="scss">
.help-layout { display: grid; gap: 20rpx; align-items: start; }
.nav { display: flex; overflow: auto; padding: 10rpx; }
.nav button { flex: none; padding: 12px 16px; color: var(--muted); background: transparent; margin: 0; min-height: 44px; font-size: 14px; line-height: 1.5; text-align: left; border-radius: 10px; }
.nav button::after { border: 0; }
.nav .active { color: var(--green); font-weight: 850; background: var(--mint); border-radius: 12rpx; }
.content, .service-content { min-width: 0; }
.content h2 { margin: 0 0 18rpx; font-size: 36rpx; }
.content h3 { margin: 0; }
.content p { color: #53615e; line-height: 1.8; }
.intro { margin-top: 0; }
.feedback-form { display: grid; gap: 20rpx; padding: 24rpx 0 32rpx; border-bottom: 1px solid var(--line); }
.feedback-form label { display: grid; gap: 10rpx; color: #263446; font-weight: 650; }
.feedback-form .input, .feedback-form .textarea { box-sizing: border-box; width: 100%; font-weight: 400; }
.picker-field { display: flex; align-items: center; min-height: 48px; }
.textarea { min-height: 180rpx; }
.feedback-history-heading, .feedback-meta { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.feedback-history-heading { margin-top: 30rpx; }
.feedback-history-heading .text-button { margin: 0; }
.feedback-item { padding: 26rpx 0; border-top: 1px solid var(--line); }
.feedback-meta text, .reply text { color: var(--muted); font-size: 24rpx; }
.feedback-item > p { margin-bottom: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.reply { margin-top: 20rpx; padding: 20rpx; border-radius: 14rpx; background: var(--mint); }
.reply p { margin: 8rpx 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.waiting-reply { margin-top: 18rpx; color: var(--muted); font-size: 26rpx; }
@media (min-width: 900px) {
  .help-layout { grid-template-columns: 220px 1fr; }
  .nav { display: block; padding: 12px; }
  .nav button { width: 100%; padding: 16px 18px; }
  .feedback-form { max-width: 720px; }
}
.service-content { display: grid; gap: 18px; }
.service-heading { display: flex; align-items: center; gap: 16px; padding: 4px 2px 8px; }
.service-heading h1 { margin: 0 0 7px; color: var(--ink); font-size: 28px; line-height: 1.25; font-weight: 800; }
.service-heading text { color: var(--muted); font-size: 13px; line-height: 1.6; }
.heading-icon { width: 56px; height: 56px; border-radius: 18px; display: grid; place-items: center; color: #fff; background: var(--green); flex: none; }
.heading-icon .service-icon { width: 30px; height: 30px; }
.service-icon { width: 22px; height: 22px; display: block; background: currentColor; -webkit-mask: var(--service-icon) center / contain no-repeat; mask: var(--service-icon) center / contain no-repeat; }
.icon-headset { --service-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 13v-2a8 8 0 0 1 16 0v2M20 17v2a2 2 0 0 1-2 2h-4'/%3E%3Crect x='2' y='11' width='5' height='7' rx='2'/%3E%3Crect x='17' y='11' width='5' height='7' rx='2'/%3E%3C/svg%3E"); }
.icon-chat { --service-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z M8 9h8 M8 13h5'/%3E%3C/svg%3E"); }
.icon-phone { --service-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 3 4 4-2 3a16 16 0 0 0 7 7l3-2 4 4-2 2C10 23 1 14 3 5Z'/%3E%3C/svg%3E"); }
.icon-box { --service-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m12 3 9 5v10l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v10 M7 5.8l10 5.5'/%3E%3C/svg%3E"); }
.icon-message { --service-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 3h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8l-5 3V5a2 2 0 0 1 2-2Z M7 8h10 M7 12h7'/%3E%3C/svg%3E"); }
.icon-document { --service-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 3H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z M14 3v6h6 M8 14h8 M8 18h5'/%3E%3C/svg%3E"); }
.contact-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.contact-card { display: flex; flex-direction: column; padding: 24px; }
.online-card { background: #f0f4ed; border-color: #d5e1d2; }
.contact-label { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
.contact-label h2 { margin: 0; font-size: 15px; font-weight: 650; color: #3b5148; }
.icon-wrap { display: grid; place-items: center; width: 36px; height: 36px; color: var(--green); background: #e9eee4; border-radius: 12px; flex: none; }
.online-card .icon-wrap { background: #fff; }
.contact-title { font-size: 22px; line-height: 1.4; font-weight: 750; color: var(--ink); }
.phone-number { white-space: nowrap; letter-spacing: .3px; font-variant-numeric: tabular-nums; }
.contact-note { font-size: 13px; color: var(--muted); line-height: 1.7; margin: 6px 0 22px; }
.contact-card .primary-btn, .phone-actions .outline-btn { margin: auto 0 0; min-height: 46px; height: auto; padding: 12px 18px; font-size: 14px; line-height: 1.5; border-radius: 12px; }
.contact-card .primary-btn { display: flex; gap: 10px; }
.phone-actions { display: flex; gap: 12px; margin-top: auto; align-items: center; }
.phone-actions .outline-btn { flex: 1; margin: 0; }
.copy-phone { margin: 0; padding: 10px 0; min-height: 46px; line-height: 1.5; color: var(--green); background: transparent; font-size: 13px; flex: none; }
.copy-phone::after, .service-shortcut::after, .service-question button::after { border: 0; }
.service-shortcuts, .service-questions { padding: 22px 24px; }
.service-shortcuts h2, .service-questions h2 { font-size: 17px; margin: 0 0 16px; color: var(--ink); }
.shortcut-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.service-shortcut { display: flex; text-align: left; align-items: center; gap: 10px; width: 100%; padding: 14px 10px; margin: 0; background: #f7f8f4; color: var(--ink); border-radius: 12px; font-size: 14px; line-height: 1.6; min-height: 72px; }
.shortcut-icon { color: var(--green); flex: none; }
.service-shortcut > view:nth-child(2) { min-width: 0; }
.service-shortcut b, .service-shortcut > view > text { display: block; }
.service-shortcut > view > text { font-size: 12px; color: var(--muted); margin-top: 3px; }
.shortcut-arrow { color: #7b8b82; font-size: 22px; margin-left: auto; flex: none; }
.service-questions h2 { margin-bottom: 4px; }
.service-question + .service-question { border-top: 1px solid var(--line); }
.service-question > button { display: flex; align-items: center; justify-content: space-between; gap: 14px; text-align: left; width: 100%; padding: 17px 0; margin: 0; min-height: 52px; font-size: 14px; line-height: 1.6; color: var(--ink); background: transparent; }
.question-toggle { color: #6b7d71; font-size: 20px; flex: none; transition: transform .15s; }
.question-toggle.expanded { transform: rotate(45deg); }
.question-answer { padding: 0 24px 18px 0; color: var(--muted); font-size: 13px; line-height: 1.8; }
.question-answer .text-button { text-align: left; padding: 8px 0 0; font-size: 13px; color: var(--green); background: transparent; line-height: 1.5; margin: 0; }
@media (min-width: 900px) { .help-page { padding-top: 36px; } }
@media (min-width: 900px) and (max-width: 1120px) { .shortcut-list { grid-template-columns: 1fr; } }
@media (max-width: 899px) {
  .service-content { gap: 14px; }
  .service-heading { padding: 8px 4px 2px; gap: 12px; }
  .service-heading h1 { font-size: 24px; }
  .heading-icon { width: 48px; height: 48px; border-radius: 15px; }
  .contact-options { gap: 12px; }
  .contact-card { padding: 20px; }
  .contact-label { margin-bottom: 16px; }
  .shortcut-list { grid-template-columns: 1fr; gap: 0; }
  .service-shortcut { border-radius: 0; background: transparent; padding: 15px 0; }
  .service-shortcut + .service-shortcut { border-top: 1px solid var(--line); }
  .service-shortcuts, .service-questions { padding: 20px; }
  .service-shortcuts h2 { margin-bottom: 2px; }
  .shortcut-icon { width: 36px; height: 36px; border-radius: 12px; background: #edf1e9; display: grid; place-items: center; }
}
@media (max-width: 560px) { .contact-options { grid-template-columns: 1fr; } .contact-label { margin-bottom: 14px; } .contact-note { margin-bottom: 18px; } .contact-title { font-size: 23px; } }
@media (prefers-reduced-motion: reduce) { .question-toggle { transition: none; } }
</style>
