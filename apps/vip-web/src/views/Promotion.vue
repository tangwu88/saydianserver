<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, data, errorMessage } from "../api";
const promotion = ref<any>();
onMounted(async () => {
  try {
    promotion.value = data(await api.get("/promotion"));
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
});
async function copy() {
  try {
    await navigator.clipboard.writeText(promotion.value.linkUrl);
    ElMessage.success("推广链接已复制");
  } catch {
    ElMessage.info("请在下方选中链接复制");
  }
}
</script>
<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>专属推广</h1>
        <p>新会员通过二维码或链接注册后，归属您的品牌伙伴账户</p>
      </div>
    </div>
    <div class="panel promotion-panel">
      <div class="qr-card">
        <span class="muted">赛电品牌伙伴</span>
        <h2>{{ promotion?.name || "正在加载" }}</h2>
        <img
          v-if="promotion"
          :src="promotion.qrDataUrl"
          alt="品牌伙伴专属推广二维码"
          width="260"
          height="260"
        />
        <p>扫码注册 · 开启健康服务</p>
        <a
          v-if="promotion"
          :href="promotion.qrDataUrl"
          :download="`赛电品牌伙伴-${promotion.partnerNo}.png`"
          ><el-button>下载二维码</el-button></a
        >
      </div>
      <div class="promotion-info">
        <el-tag>专属推广链接</el-tag>
        <h2>邀请会员，提供持续服务</h2>
        <p>
          会员在 H5 完成注册后，可使用同一账号登录赛电
          App。所属会员的健康档案、设备及测量记录可在会员页面查看。
        </p>
        <el-input
          :model-value="promotion?.linkUrl || ''"
          readonly
          aria-label="专属推广链接"
        /><el-button
          type="primary"
          :disabled="!promotion"
          @click="copy"
          style="margin-top: 16px"
          >复制链接</el-button
        >
        <p class="muted note">
          已有账号登录不会改变品牌伙伴归属。二维码长期有效，账户停用后推广链接失效。
        </p>
      </div>
    </div>
  </section>
</template>
<style scoped>
.promotion-panel {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 48px;
  align-items: center;
  padding: 36px;
}
.qr-card {
  background: #fff8f9;
  border: 1px solid #f1d8de;
  border-radius: 12px;
  padding: 28px;
  text-align: center;
}
.qr-card > span {
  font-size: 12px;
}
.qr-card h2 {
  margin: 12px 0 20px;
}
.qr-card img {
  max-width: 100%;
  height: auto;
}
.qr-card p {
  font-size: 13px;
  color: #9b6370;
  margin: 18px 0;
}
.promotion-info h2 {
  font-size: 25px;
  margin: 20px 0 16px;
}
.promotion-info p {
  font-size: 14px;
  line-height: 1.9;
  color: #788397;
  margin-bottom: 24px;
}
.promotion-info .note {
  font-size: 12px;
  margin: 25px 0 0;
}
@media (max-width: 950px) {
  .promotion-panel {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 24px;
  }
  .qr-card {
    max-width: 340px;
    margin: auto;
  }
}
</style>
