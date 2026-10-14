<script setup lang="ts">
import { onMounted, ref, nextTick } from "vue";
import { useRoute } from "vue-router";
import {
  Printer,
  Refresh,
  CircleCheck,
  CircleClose,
} from "@element-plus/icons-vue";
import { api, data, errorMessage } from "../api";
import { partnerLevelName } from "@saydian/app-contracts";
import saydianLogo from "../assets/saydian-logo-red.png";
import PageError from "../components/PageError.vue";
const route = useRoute(),
  certificate = ref<any>(),
  busy = ref(false),
  error = ref("");
const publicView = !!route.params.code;
async function load() {
  busy.value = true;
  error.value = "";
  certificate.value = undefined;
  try {
    certificate.value = data(
      await api.get(
        publicView
          ? `/public/certificate/${encodeURIComponent(String(route.params.code))}`
          : "/certificate",
      ),
    );
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function printCertificate() {
  await load(); // Revalidate current status and tier before producing a printable copy.
  if (!certificate.value?.active) return;
  await nextTick();
  window.print();
}
onMounted(load);
</script>
<template>
  <section
    class="page certificate-page"
    :class="{ 'public-certificate': publicView }"
    v-loading="busy"
  >
    <div class="page-head certificate-tools">
      <h1>{{ publicView ? "授权证书核验" : "电子授权证书" }}</h1>
      <div class="button-row">
        <el-button :icon="Refresh" :loading="busy" @click="load"
          >刷新</el-button
        >
        <el-button
          v-if="!publicView"
          type="primary"
          :icon="Printer"
          :disabled="!certificate?.active || busy"
          @click="printCertificate"
          >打印证书</el-button
        >
      </div>
    </div>
    <PageError :message="error" @retry="load" />
    <template v-if="certificate">
      <div v-if="publicView" class="panel verification-result" role="status">
        <el-icon :class="certificate.active ? 'valid' : 'invalid'"
          ><component :is="certificate.active ? CircleCheck : CircleClose"
        /></el-icon>
        <h2>{{ certificate.active ? "授权有效" : "授权已失效" }}</h2>
        <p>
          {{ certificate.partnerName }} ·
          {{ partnerLevelName(certificate.level) }}
        </p>
        <p>证书编号：{{ certificate.certificateNo }}</p>
        <p>授权范围：{{ certificate.scope }}</p>
        <small class="muted">以本页当前核验结果为准</small>
      </div>
      <article
        v-else
        class="authorization-certificate"
        :class="{ revoked: !certificate.active }"
      >
        <div class="certificate-brand">
          <img :src="saydianLogo" alt="赛电" class="certificate-logo" />
        </div>
        <div class="certificate-heading">
          <h2>品牌伙伴授权证书</h2>
          <p>BRAND PARTNER AUTHORIZATION</p>
        </div>
        <p class="certificate-number">
          证书编号 {{ certificate.certificateNo }}
        </p>
        <p class="intro">兹授权</p>
        <h3 class="partner-name">{{ certificate.partnerName }}</h3>
        <p class="cooperation-level">
          为赛电品牌
          <strong>{{ partnerLevelName(certificate.level) }}伙伴</strong>
        </p>
        <div class="authorization-scope">
          <p>授权范围</p>
          <b>{{ certificate.scope }}</b>
        </div>
        <dl class="certificate-facts">
          <div>
            <dt>授权方</dt>
            <dd>{{ certificate.issuer }}</dd>
          </div>
          <div>
            <dt>合作登记日期</dt>
            <dd>{{ String(certificate.registeredAt).slice(0, 10) }}</dd>
          </div>
          <div>
            <dt>有效期</dt>
            <dd>{{ certificate.validity }}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{{ certificate.active ? "授权有效" : "授权已失效" }}</dd>
          </div>
        </dl>
        <footer class="certificate-footer">
          <div>
            <b>赛电品牌伙伴平台</b>
            <p>扫描二维码核验当前授权状态</p>
            <small
              >生成日期
              {{ String(certificate.generatedAt).slice(0, 10) }}</small
            >
          </div>
          <img
            :src="certificate.qrDataUrl"
            alt="授权证书核验二维码"
            width="120"
            height="120"
          />
        </footer>
      </article>
      <p v-if="!publicView" class="muted certificate-tools">
        账户停用后授权失效；打印件可通过二维码核验当前状态。
      </p>
    </template>
  </section>
</template>
<style scoped>
.certificate-page {
  max-width: 1120px;
  margin: 0 auto;
}
.authorization-certificate {
  box-sizing: border-box;
  max-width: 794px;
  min-height: 970px;
  margin: 24px auto;
  padding: 56px;
  border: 8px double #a88745;
  outline: 1px solid #eadfca;
  outline-offset: -20px;
  background: #fffdf8;
  color: #273044;
}
.certificate-logo {
  display: block;
  width: 185px;
  max-width: 45%;
  height: auto;
}
.certificate-brand {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 2px;
}
.certificate-brand span {
  color: #bc2038;
  font-size: 18px;
  letter-spacing: 0;
}
.certificate-heading {
  text-align: center;
  margin: 60px 0 26px;
}
.certificate-heading h2 {
  font-size: 34px;
  letter-spacing: 5px;
  margin-bottom: 16px;
}
.certificate-heading p {
  color: #9b783c;
  letter-spacing: 2px;
  font-size: 12px;
}
.certificate-number {
  text-align: center;
  font-size: 12px;
  overflow-wrap: anywhere;
  color: #746b59;
}
.intro {
  margin: 54px 0 16px;
  text-align: center;
}
.partner-name {
  font-size: 30px;
  text-align: center;
  overflow-wrap: anywhere;
  margin: 0 0 20px;
}
.cooperation-level {
  text-align: center;
  line-height: 1.8;
}
.authorization-scope {
  text-align: center;
  margin: 36px 0;
  padding: 18px;
  border-top: 1px solid #dfcfac;
  border-bottom: 1px solid #dfcfac;
  line-height: 1.8;
}
.authorization-scope p {
  font-size: 12px;
  color: #746b59;
  margin: 0 0 8px;
}
.certificate-facts {
  margin: 35px 0;
}
.certificate-facts div {
  display: grid;
  grid-template-columns: 120px 1fr;
  margin: 18px 0;
  gap: 14px;
}
.certificate-facts dt {
  color: #746b59;
}
.certificate-facts dd {
  margin: 0;
}
.certificate-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 40px;
}
.certificate-footer p,
.certificate-footer small {
  color: #746b59;
  font-size: 12px;
}
.verification-result {
  max-width: 560px;
  margin: 40px auto;
  text-align: center;
  padding: 36px;
  overflow-wrap: anywhere;
}
.verification-result .el-icon {
  font-size: 54px;
}
.valid {
  color: #26844d;
}
.invalid {
  color: #bc2038;
}
.revoked {
  filter: grayscale(1);
}
@media (max-width: 650px) {
  .authorization-certificate {
    padding: 30px 22px;
    min-height: auto;
  }
  .certificate-heading {
    margin-top: 42px;
  }
  .certificate-heading h2 {
    font-size: 25px;
    letter-spacing: 2px;
  }
  .certificate-facts div {
    grid-template-columns: 95px 1fr;
    font-size: 13px;
  }
  .certificate-footer {
    flex-wrap: wrap;
  }
}
@media screen and (max-width: 600px),
  screen and (max-width: 950px) and (max-height: 500px) {
  .page-head {
    flex-wrap: wrap;
  }
  .page-head .button-row {
    margin-left: auto;
  }
  .authorization-certificate {
    padding: 28px 18px;
    margin: 16px 0;
    border-width: 5px;
    outline-offset: -12px;
  }
  .certificate-logo {
    width: 132px;
    max-width: 52%;
  }
  .certificate-heading {
    margin: 32px 0 18px;
  }
  .certificate-heading h2 {
    font-size: 22px;
    line-height: 1.6;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }
  .certificate-heading p {
    font-size: 9px;
    letter-spacing: 1px;
    line-height: 1.7;
  }
  .certificate-number {
    font-size: 11px;
    line-height: 1.7;
  }
  .intro {
    margin-top: 30px;
    font-size: 14px;
  }
  .partner-name {
    font-size: 24px;
    line-height: 1.6;
  }
  .cooperation-level {
    font-size: 14px;
  }
  .authorization-scope {
    margin: 24px 0;
    padding: 14px 0;
    font-size: 14px;
  }
  .certificate-facts {
    margin: 22px 0;
  }
  .certificate-facts div {
    grid-template-columns: 90px minmax(0, 1fr);
    gap: 8px;
    line-height: 1.7;
  }
  .certificate-facts dd {
    overflow-wrap: anywhere;
  }
  .certificate-footer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 90px;
    gap: 12px;
    margin-top: 24px;
  }
  .certificate-footer b {
    font-size: 13px;
  }
  .certificate-footer img {
    width: 90px;
    height: 90px;
  }
  .certificate-footer p {
    line-height: 1.7;
    margin: 8px 0;
  }
  .certificate-page > .certificate-tools:last-child {
    font-size: 12px;
    line-height: 1.8;
  }
  .verification-result {
    margin: 16px;
    padding: 24px 16px;
    font-size: 14px;
    line-height: 1.7;
  }
  .public-certificate {
    min-height: 100svh;
    padding: calc(24px + env(safe-area-inset-top)) 16px 24px;
  }
  .public-certificate .verification-result {
    margin: 16px 0;
  }
}
</style>
<style>
@page {
  size: A4 portrait;
  margin: 12mm;
}
@media print {
  body,
  #app,
  .layout,
  .workspace {
    display: block !important;
    background: white !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .sidebar,
  .topbar,
  .mobile-shortcuts,
  .certificate-tools,
  .el-overlay,
  .page-error {
    display: none !important;
  }
  #main-content,
  .certificate-page {
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
  }
  .certificate-logo {
    width: 160px !important;
  }
  .certificate-heading {
    margin: 28px 0 20px !important;
  }
  .intro {
    margin-top: 32px !important;
  }
  .authorization-scope {
    margin: 24px 0 !important;
  }
  .certificate-facts {
    margin: 24px 0 !important;
  }
  .certificate-facts div {
    margin: 14px 0 !important;
  }
  .certificate-footer {
    margin-top: 28px !important;
  }
  .authorization-certificate {
    width: 186mm !important;
    max-width: none !important;
    min-height: 267mm !important;
    margin: 0 !important;
    padding: 14mm !important;
    break-inside: avoid;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
</style>
