<template>
  <view class="page"
    ><view class="container card"
      ><view class="section-title">申请售后</view
      ><view class="field"
        ><text>售后类型</text
        ><picker
          :range="types.map((x) => x.label)"
          @change="changeType"
          ><view
            >{{ types.find((x) => x.value === type)?.label }} ›</view
          ></picker
        ></view
      ><view class="field"
        ><text>申请金额</text
        ><input
          v-model="amount"
          type="digit"
          placeholder="按实际可退金额填写" /></view
      ><view class="field"
        ><text>售后原因</text
        ><input v-model="reason" placeholder="请简要说明原因" /></view
      ><textarea
        v-model="description"
        class="textarea"
        placeholder="补充问题描述（选填）"
      /><view class="tip"
        >申请将同步至聚水潭 ERP，退款在售后状态满足条件后原路退回。</view
      ><view class="primary-btn" @click="submit">提交申请</view></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { ref } from "vue";
import { api, toast } from "../../api";
const types = [
    { label: "仅退款", value: "REFUND_ONLY" },
    { label: "退货退款", value: "RETURN_REFUND" },
    { label: "换货", value: "EXCHANGE" },
  ],
  type = ref("REFUND_ONLY"),
  amount = ref(""),
  reason = ref(""),
  description = ref(""),
  orderId = ref("");
onLoad((o) => (orderId.value = o?.orderId || ""));
function changeType(event: { detail: { value: string | number } }) {
  const selected = types[Number(event.detail.value)];
  if (selected) type.value = selected.value;
}
async function submit() {
  if (!reason.value) return toast("请填写售后原因");
  try {
    await api(`/storefront/orders/${orderId.value}/after-sales`, {
      method: "POST",
      auth: true,
      data: {
        type: type.value,
        requestedCents: amount.value
          ? Math.round(Number(amount.value) * 100)
          : undefined,
        reason: reason.value,
        description: description.value,
        evidenceImages: [],
      },
    });
    uni.showToast({ title: "申请已提交" });
    setTimeout(() => uni.navigateBack(), 800);
  } catch (e) {
    toast(e);
  }
}
</script>
<style scoped lang="scss">
.field {
  min-height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
}
.field input,
.field picker {
  flex: 1;
  text-align: right;
  margin-left: 28rpx;
}
.textarea {
  margin-top: 24rpx;
}
.tip {
  margin: 24rpx 0;
  color: var(--muted);
  font-size: 23rpx;
  line-height: 1.7;
}
</style>
