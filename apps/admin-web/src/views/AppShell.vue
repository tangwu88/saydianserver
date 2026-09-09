<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { api, clearAdminToken, getAdminRoles } from "../api";
import { canAdminResource } from "@saydian/app-contracts";

const route = useRoute();
const router = useRouter();
const groups = [
  { title: "总览", items: [["/", "运营概览"]] },
  { title: "会员与健康", items: [
    ["/members", "会员与健康档案"], ["/care", "远程关爱"],
    ["/warnings", "健康预警"], ["/health-reports", "健康报告"],
    ["/health-report-offers", "报告方案"], ["/devices", "设备"],
  ] },
  { title: "商城", items: [
    ["/commerce-products", "商品"], ["/commerce-categories", "分类"],
    ["/commerce-banners", "首页轮播"], ["/commerce-business-configs", "商城设置"],
    ["/commerce-orders", "订单"], ["/commerce-after-sales", "售后退款"],
    ["/commerce-reviews", "商品评价"],
    ["/commerce-coupons", "优惠券"], ["/commerce-employees", "员工推广"],
    ["/commerce-commissions", "奖金明细"], ["/commerce-jobs", "ERP任务"],
    ["/payments", "支付流水"],
    ["/commerce-withdrawals", "提现审核"],
  ] },
  { title: "运营", items: [
    ["/notifications", "站内通知"], ["/notification-campaigns", "通知群发"],
    ["/articles", "内容"], ["/article-categories", "内容分类"],
    ["/legal-documents", "协议"], ["/feedback", "反馈"],
    ["/settings", "客服与更新"],
  ] },
  { title: "系统", items: [
    ["/api-docs", "接口中心"], ["/integrations", "第三方服务"],
    ["/admin-users", "后台账号"], ["/account-deletions", "注销任务"],
    ["/audit-logs", "审计日志"],
  ] },
] as const;
const visibleGroups = computed(() => groups.map((group, index) => ({ ...group, index,
  items: group.items.filter((item) => canAdminResource(getAdminRoles(), item[0].slice(1) || "dashboard")),
})).filter((group) => group.items.length));
const menuRef = ref<{ close: (index: string) => void } | null>(null);

async function closeAllGroups(): Promise<void> {
  await nextTick();
  groups.forEach((_, index) => menuRef.value?.close(`group-${index}`));
}

onMounted(closeAllGroups);

async function navigate(path: string): Promise<void> {
  await router.push(path);
}

async function logout(): Promise<void> {
  try { await api.post("/auth/logout"); } catch { /* local logout remains safe */ }
  clearAdminToken();
  ElMessage.success("已退出");
  await router.replace("/login");
}
</script>

<template>
  <el-container class="shell">
    <el-aside width="240px" class="aside">
      <div class="brand">Saydian赛电</div>
      <el-menu ref="menuRef" default-active="" :default-openeds="[]" background-color="#17202c" text-color="#c7d0dc" active-text-color="#ffffff">
        <el-sub-menu v-for="group in visibleGroups" :key="group.title" :index="`group-${group.index}`">
          <template #title>{{ group.title }}</template>
          <el-menu-item v-for="item in group.items" :key="item[0]" :index="item[0]" :class="{ 'manual-active': route.path === item[0] }" @click="navigate(item[0])">{{ item[1] }}</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header"><span>App 运营与数据管理</span><el-button text @click="logout">退出</el-button></el-header>
      <el-main><router-view :key="route.fullPath" /></el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.shell { min-height: 100vh; }
.shell > :deep(.el-container) { min-width: 0; }
.aside { flex-shrink: 0; background: #17202c; }
.brand { height: 64px; display: grid; place-items: center; color: white; font-size: 20px; font-weight: 700; }
:deep(.el-sub-menu__title) { color: #f2f5f9; font-size: 16px; font-weight: 700; }
:deep(.el-menu-item.manual-active) { color: #fff; background: #236fbb; }
:deep(.el-menu-item.is-active:not(.manual-active)) { color: #c7d0dc; background: #17202c; }
.header { background: white; border-bottom: 1px solid #e5e9ef; display: flex; align-items: center; justify-content: space-between; }
.el-main { padding: 0; }
</style>
