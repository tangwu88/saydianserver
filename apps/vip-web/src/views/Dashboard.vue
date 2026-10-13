<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, data, errorMessage } from "../api";
import { money } from "../present";
const overview = ref<any>(),
  busy = ref(true);
onMounted(async () => {
  try {
    overview.value = data(await api.get("/dashboard"));
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  } finally {
    busy.value = false;
  }
});
</script>
<template>
  <section class="page" v-loading="busy">
    <div class="page-head">
      <div>
        <h1>
          {{ overview?.name ? `${overview.name}，欢迎回来` : "平台概览" }}
        </h1>
        <p>查看会员服务、分销采购与账户资金</p>
      </div>
      <el-tag v-if="overview?.level" type="info">{{
        overview.level.name
      }}</el-tag>
    </div>
    <el-alert
      v-if="overview?.preview"
      title="当前为本地演示，会员资料与资金金额均为合成测试数据。"
      type="info"
      :closable="false"
      style="margin-bottom: 20px"
    />
    <div class="overview-grid">
      <article class="balance-card">
        <span>可消费余额</span
        ><strong>{{ money(overview?.wallet?.balanceCents) }}</strong>
        <p>保证金独立管理，采购从余额扣款</p>
        <router-link to="/wallet"
          ><el-button>在线充值 →</el-button></router-link
        >
      </article>
      <article class="panel metric-card">
        <span>所属会员</span><strong>{{ overview?.memberCount ?? "—" }}</strong
        ><router-link to="/members">查看会员档案 →</router-link>
      </article>
      <article class="panel metric-card">
        <span>采购订单</span><strong>{{ overview?.orderCount ?? "—" }}</strong
        ><router-link to="/orders">查看采购记录 →</router-link>
      </article>
      <article class="panel metric-card">
        <span>保证金</span
        ><strong>{{ money(overview?.wallet?.depositCents) }}</strong
        ><router-link to="/deposit">查看保证金记录 →</router-link>
      </article>
    </div>
    <div class="panel">
      <h2>常用服务</h2>
      <div class="quick-links">
        <router-link to="/promotion"
          ><b>专属推广二维码</b
          ><span>邀请新会员，建立专属服务关系</span></router-link
        ><router-link to="/products"
          ><b>按分销价采购</b
          ><span>查看当前等级价格，使用余额下单</span></router-link
        ><router-link to="/ledger"
          ><b>查询资金明细</b
          ><span>充值、消费和退款记录随时可查</span></router-link
        >
      </div>
    </div>
    <div class="panel account-card">
      <h2>伙伴账户</h2>
      <dl class="facts">
        <div>
          <dt>伙伴编号</dt>
          <dd>{{ overview?.partnerNo || "—" }}</dd>
        </div>
        <div>
          <dt>登录账号</dt>
          <dd>{{ overview?.username || "—" }}</dd>
        </div>
        <div>
          <dt>累计采购</dt>
          <dd>{{ money(overview?.purchaseCents) }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
<style scoped>
.overview-grid {
  display: grid;
  grid-template-columns: 1.8fr 1fr 1fr 1fr;
  gap: 18px;
  margin-bottom: 22px;
}
.balance-card {
  border-radius: 14px;
  padding: 26px;
  background: #be2038;
  color: white;
}
.balance-card > span {
  color: #ffd9df;
  font-size: 13px;
}
.balance-card strong {
  display: block;
  font-size: 35px;
  margin: 20px 0 12px;
}
.balance-card p {
  font-size: 12px;
  color: #f0b8c3;
  margin-bottom: 22px;
}
.balance-card .el-button {
  background: white;
  border: 0;
  color: #a91f33;
}
.metric-card {
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  padding: 26px 20px;
}
.metric-card > span {
  color: #788397;
  font-size: 13px;
}
.metric-card strong {
  font-size: 28px;
  margin: 23px 0;
}
.metric-card a {
  font-size: 12px;
  margin-top: auto;
}
.quick-links {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 22px;
}
.quick-links a {
  border: 1px solid #e8ebf1;
  border-radius: 10px;
  padding: 22px;
  color: #18212f;
}
.quick-links a:hover {
  border-color: #d98c98;
}
.quick-links b,
.quick-links span {
  display: block;
}
.quick-links span {
  font-size: 12px;
  color: #788397;
  margin-top: 11px;
  line-height: 1.7;
}
.account-card .facts {
  margin: 0;
}
@media (max-width: 1150px) {
  .overview-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 760px) {
  .quick-links {
    grid-template-columns: 1fr;
  }
  .overview-grid {
    gap: 12px;
  }
  .balance-card {
    grid-column: 1 / -1;
  }
  .metric-card strong {
    font-size: 23px;
  }
}
</style>
