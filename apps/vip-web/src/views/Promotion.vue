<script setup lang="ts">
import { onMounted, ref } from "vue";
import { CopyDocument, Download, User } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { api, data, errorMessage } from "../api";
import PageError from "../components/PageError.vue";
const promotion = ref<any>(),
  busy = ref(false),
  error = ref(""),
  linkInput = ref<HTMLInputElement>();
async function load() {
  busy.value = true;
  error.value = "";
  try {
    promotion.value = data(await api.get("/promotion"));
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
async function copy() {
  if (!promotion.value) return;
  try {
    await navigator.clipboard.writeText(promotion.value.linkUrl);
    ElMessage.success("链接已复制，可直接发给会员");
  } catch {
    linkInput.value?.focus();
    linkInput.value?.select();
    ElMessage.info("链接已选中，请长按或按 Ctrl/Cmd+C 复制");
  }
}
</script>
<template>
  <section class="page promotion-page">
    <div class="page-head">
      <h1>推广二维码</h1>
      <router-link to="/members" class="action-link"
        ><el-icon><User /></el-icon>查看会员</router-link
      >
    </div>
    <PageError :message="error" @retry="load" />
    <div class="panel promotion-panel" v-loading="busy">
      <div class="qr-card">
        <h2>{{ promotion?.name || "我的推广码" }}</h2>
        <img
          v-if="promotion"
          :src="promotion.qrDataUrl"
          alt="扫码注册会员"
          width="224"
          height="224"
        />
        <p>扫码注册会员</p>
      </div>
      <div class="promotion-actions">
        <h2>发给会员，即可邀请注册</h2>
        <p class="muted">新注册会员会显示在“我的会员”中。</p>
        <div class="button-row">
          <el-button
            type="primary"
            size="large"
            :icon="CopyDocument"
            :disabled="!promotion"
            @click="copy"
            >复制邀请链接</el-button
          ><a
            v-if="promotion"
            class="action-link"
            :href="promotion.qrDataUrl"
            :download="`赛电推广码-${promotion.partnerNo}.png`"
            ><el-icon><Download /></el-icon>保存二维码</a
          >
        </div>
        <label for="promotion-link" class="field-label">邀请链接</label
        ><input
          id="promotion-link"
          ref="linkInput"
          class="plain-input"
          :value="promotion?.linkUrl || ''"
          readonly
          @focus="linkInput?.select()"
        />
        <details class="quiet-details">
          <summary>推广规则</summary>
          <p>已有会员登录不会改变归属。账户停用后，此二维码和链接将失效。</p>
        </details>
      </div>
    </div>
  </section>
</template>
<style scoped>
.promotion-page {
  max-width: 1000px;
}
.promotion-panel {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 32px;
  align-items: center;
}
.qr-card {
  text-align: center;
  padding: 16px;
  border: 1px solid #e8ebf1;
  border-radius: 12px;
}
.qr-card h2 {
  font-size: 18px;
  margin: 0 0 12px;
}
.qr-card img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: auto;
}
.qr-card p {
  font-size: 14px;
  margin: 10px 0 0;
}
.promotion-actions h2 {
  font-size: 21px;
}
.promotion-actions > p {
  font-size: 14px;
}
.button-row {
  margin: 22px 0;
  gap: 12px;
}
.field-label {
  display: block;
  font-size: 13px;
  color: #5d6879;
  margin-bottom: 8px;
}
.quiet-details {
  margin-top: 18px;
}
@media (max-width: 680px) {
  .promotion-panel {
    grid-template-columns: 1fr;
    gap: 22px;
  }
  .qr-card {
    width: 248px;
    margin: auto;
  }
  .promotion-actions h2 {
    display: none;
  }
  .promotion-actions > p {
    text-align: center;
  }
  .button-row {
    justify-content: center;
    margin: 12px 0 20px;
  }
}
</style>
