<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  Share,
  ShoppingCart,
  Box,
  User,
  Wallet,
  DocumentChecked,
  ArrowRight,
} from "@element-plus/icons-vue";
import { api, data, errorMessage } from "../api";
import { money } from "../present";
import PageError from "../components/PageError.vue";
const overview = ref<any>(),
  busy = ref(true),
  error = ref("");
const actions = [
  {
    path: "/promotion",
    title: "邀请会员",
    hint: "复制链接 · 保存二维码",
    icon: Share,
  },
  {
    path: "/products",
    title: "采购商品",
    hint: "选规格 · 余额付款",
    icon: ShoppingCart,
  },
  {
    path: "/orders",
    title: "查看订单",
    hint: "采购记录 · 发货物流",
    icon: Box,
  },
];
async function load() {
  busy.value = true;
  error.value = "";
  try {
    overview.value = data(await api.get("/dashboard"));
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section class="page dashboard-page" v-loading="busy">
    <div class="page-head">
      <h1>{{ overview?.name ? `${overview.name}，你好` : "首页" }}</h1>
      <el-tag v-if="overview?.level" type="info">{{
        overview.level.name
      }}</el-tag>
    </div>
    <PageError :message="error" @retry="load" />
    <el-alert
      v-if="overview?.preview"
      title="本地演示：以下为合成测试数据"
      type="info"
      :closable="false"
      class="section-space"
    />
    <div class="quick-links">
      <router-link
        v-for="action in actions"
        :key="action.path"
        :to="action.path"
        class="panel quick-link"
        ><el-icon class="action-icon"><component :is="action.icon" /></el-icon>
        <div>
          <b>{{ action.title }}</b
          ><small>{{ action.hint }}</small>
        </div>
        <el-icon><ArrowRight /></el-icon
      ></router-link>
    </div>
    <div class="overview-grid">
      <article class="balance-card">
        <span
          ><el-icon><Wallet /></el-icon>可用余额</span
        ><strong>{{ money(overview?.wallet?.balanceCents) }}</strong>
        <div class="button-row">
          <router-link to="/wallet" class="action-link">充值</router-link
          ><router-link to="/ledger" class="balance-detail"
            >收支明细</router-link
          >
        </div>
      </article>
      <router-link to="/members" class="panel metric-card"
        ><span
          ><el-icon><User /></el-icon>我的会员</span
        ><strong>{{ overview?.memberCount ?? "—" }}<small> 人</small></strong
        ><span class="metric-link"
          >{{ overview?.canViewMemberHealth ? "查看档案" : "查看会员" }}
          <el-icon><ArrowRight /></el-icon></span
      ></router-link>
      <router-link to="/orders" class="panel metric-card"
        ><span
          ><el-icon><Box /></el-icon>采购订单</span
        ><strong>{{ overview?.orderCount ?? "—" }}<small> 笔</small></strong
        ><span class="metric-link"
          >查看订单 <el-icon><ArrowRight /></el-icon></span
      ></router-link>
    </div>
    <div class="panel">
      <dl class="facts account-facts">
        <div>
          <dt>累计采购</dt>
          <dd>{{ money(overview?.purchaseCents) }}</dd>
        </div>
        <div>
          <dt>保证金</dt>
          <dd>
            <router-link to="/deposit"
              >{{ money(overview?.wallet?.depositCents) }} · 查看</router-link
            >
          </dd>
        </div>
        <div>
          <dt>登录账号</dt>
          <dd>{{ overview?.username || "—" }}</dd>
        </div>
      </dl>
      <router-link to="/certificate" class="action-link"
        ><el-icon><DocumentChecked /></el-icon>查看 / 打印授权证书</router-link
      >
      <details class="quiet-details">
        <summary>账户信息</summary>
        <p>伙伴编号：{{ overview?.partnerNo || "—" }}</p>
      </details>
    </div>
  </section>
</template>
<style scoped>
.quick-links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.quick-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  color: #18212f;
}
.quick-link .action-icon {
  font-size: 25px;
  color: #c9223b;
  background: #fcebed;
  border-radius: 10px;
  width: 46px;
  height: 46px;
  flex-shrink: 0;
}
.quick-link > div {
  flex: 1;
}
.quick-link b {
  font-size: 16px;
}
.quick-link small {
  display: block;
  font-size: 12px;
  color: #637084;
  margin-top: 8px;
}
.quick-link > .el-icon:last-child {
  color: #8995a6;
}
.overview-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.balance-card {
  background: #bc2038;
  border-radius: 14px;
  padding: 24px;
  color: #fff;
}
.balance-card > span,
.metric-card > span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.balance-card strong,
.metric-card strong {
  display: block;
  font-size: 32px;
  margin: 18px 0;
}
.balance-card .action-link {
  background: white;
  color: #a31b30;
  min-width: 92px;
}
.balance-detail {
  color: white;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.metric-card {
  margin: 0;
  padding: 24px;
  color: #18212f;
}
.metric-card > span {
  color: #637084;
}
.metric-card strong small {
  font-weight: 400;
  font-size: 14px;
}
.metric-card .metric-link {
  color: #b82237;
  font-size: 13px;
}
.account-facts {
  margin-bottom: 16px;
}
.quiet-details {
  border-top: 1px solid #e8ebf1;
  padding-top: 14px;
}
@media (max-width: 1150px) {
  .quick-links {
    gap: 10px;
  }
  .quick-link {
    padding: 16px;
    flex-wrap: wrap;
  }
  .quick-link > .el-icon:last-child {
    display: none;
  }
}
@media (max-width: 650px) {
  .quick-links {
    grid-template-columns: 1fr;
  }
  .quick-link {
    flex-wrap: nowrap;
    margin-bottom: 0;
    padding: 14px 16px;
  }
  .quick-links {
    margin-bottom: 20px;
  }
  .quick-link small {
    margin-top: 4px;
  }
  .quick-link > .el-icon:last-child {
    display: block;
  }
  .overview-grid {
    grid-template-columns: 1fr 1fr;
  }
  .balance-card {
    grid-column: 1/-1;
  }
  .balance-card strong {
    font-size: 34px;
    margin: 14px 0;
  }
  .metric-card {
    padding: 18px;
  }
  .metric-card strong {
    font-size: 28px;
  }
}
@media (max-width: 600px), (max-width: 950px) and (max-height: 500px) {
  .dashboard-page {
    display: flex;
    flex-direction: column;
  }
  .page-head {
    order: 0;
  }
  .page-head h1 {
    font-size: 20px;
  }
  .page-head .el-tag {
    flex-shrink: 0;
  }
  .overview-grid {
    order: 1;
    gap: 10px;
    margin-bottom: 16px;
  }
  .quick-links {
    order: 2;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }
  .dashboard-page > .panel {
    order: 3;
  }
  .quick-link {
    flex-direction: column;
    justify-content: center;
    gap: 10px;
    padding: 14px 6px;
    text-align: center;
  }
  .quick-link .action-icon {
    width: 38px;
    height: 38px;
    font-size: 22px;
  }
  .quick-link b {
    font-size: 13px;
  }
  .quick-link small,
  .quick-link > .el-icon:last-child {
    display: none;
  }
  .quick-link > div {
    flex: initial;
    min-width: 0;
  }
  .balance-card {
    padding: 20px;
  }
  .balance-card strong {
    font-size: clamp(28px, 8vw, 34px);
    overflow-wrap: anywhere;
  }
  .balance-detail {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 14px;
  }
  .metric-card {
    padding: 16px;
  }
  .metric-card strong {
    margin: 14px 0;
  }
  .account-facts {
    font-size: 13px;
  }
  .account-facts > div:last-child {
    grid-column: 1 / -1;
  }
  .dashboard-page > .panel > .action-link {
    width: 100%;
  }
}
</style>
