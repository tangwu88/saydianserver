<template>
  <GlobalHelp v-if="isGlobalMall && ['agreement', 'privacy'].includes(active)" :key="active" :initial-section="active" />
  <template v-else>
    <DesktopHeader />
    <view class="page">
      <view class="container help-layout">
        <view class="card nav">
          <view v-for="item in sections" :key="item.key" :class="active === item.key && 'active'" @click="selectSection(item.key)">{{ item.label }}</view>
        </view>
        <view class="card content">
          <view v-if="error" class="error-state" role="alert">{{ error }}<button class="text-button" @click="loadSupport">重试</button></view>
          <template v-if="active === 'service'">
            <h2>客服与服务</h2>
            <p>{{ service.phone ? `客服电话：${service.phone}` : "客服电话暂未提供" }}</p>
            <view class="service-actions"><button v-if="service.phone" class="outline-btn" @click="callService">拨打客服</button><button v-if="service.wecomUrl" class="outline-btn" @click="openService">在线客服</button></view>
            <p v-if="!service.phone && !service.wecomUrl && !error">如需退换货，请在订单详情中申请售后。</p>
            <button class="text-button" @click="orders">查看我的订单</button>
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
            <h2>售后政策</h2><rich-text v-if="policies.afterSale" :nodes="policies.afterSale" /><p v-else>售后政策暂未提供，请联系客服确认。您可在订单详情中提交售后申请并查看进度。</p>
          </template>
          <template v-else-if="active === 'privacy'">
            <h2>隐私政策</h2><rich-text v-if="policies.privacy" :nodes="policies.privacy" /><p v-else>隐私政策尚未在商城后台配置。</p>
          </template>
          <template v-else-if="active === 'agreement'">
            <h2>用户协议</h2><rich-text v-if="policies.service" :nodes="policies.service" /><p v-else>用户协议尚未在商城后台配置。</p>
          </template>
        </view>
      </view>
    </view>
  </template>
</template>

<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { reactive, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import GlobalHelp from "../../components/GlobalHelp.vue";
import { api, requireLogin, toast } from "../../api";
import { isGlobalMall } from "../../realm";

const error = ref("");
const active = ref("service");
const service = reactive<any>({});
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
function callService(): void { if (/^[+\d -]{5,30}$/.test(String(service.phone))) uni.makePhoneCall({ phoneNumber: String(service.phone) }); else toast("客服电话格式尚未配置正确"); }
function openService(): void {
  try {
    const url = new URL(String(service.wecomUrl));
    if (url.protocol !== "https:" || url.hostname !== "work.weixin.qq.com" || url.username || url.password) throw new Error("企业客服地址未正确配置");
    /* #ifdef H5 */
    location.assign(url.href);
    /* #endif */
    /* #ifndef H5 */
    uni.setClipboardData({ data: url.href });
    /* #endif */
  } catch (cause) { toast(cause); }
}
</script>

<style scoped lang="scss">
.help-layout { display: grid; gap: 20rpx; }
.nav { display: flex; overflow: auto; padding: 10rpx; }
.nav view { flex: none; padding: 22rpx 28rpx; color: var(--muted); }
.nav .active { color: var(--green); font-weight: 850; background: var(--mint); border-radius: 12rpx; }
.content { min-height: 460rpx; }
.content h2 { margin: 0 0 18rpx; font-size: 36rpx; }
.content h3 { margin: 0; }
.content p { color: #53615e; line-height: 1.8; }
.intro { margin-top: 0; }
.service-actions { display: flex; flex-wrap: wrap; gap: 12rpx; }
.service-actions button { flex: 1 1 220rpx; margin: 0; }
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
  .nav view { padding: 16px 18px; }
  .content { min-height: 600px; }
  .feedback-form { max-width: 720px; }
}
</style>
