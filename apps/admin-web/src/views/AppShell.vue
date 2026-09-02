<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { api, clearAdminToken } from "../api";

const route = useRoute();
const router = useRouter();
const items = [
  ["/", "概览"], ["/members", "会员"], ["/care", "远程关爱"],
  ["/warnings", "健康预警"], ["/notifications", "通知"], ["/devices", "设备"],
  ["/articles", "内容"], ["/article-categories", "内容分类"], ["/legal-documents", "协议"], ["/feedback", "反馈"],
  ["/settings", "客服与更新"],
  ["/integrations", "集成状态"], ["/admin-users", "后台账号"],
  ["/account-deletions", "注销任务"], ["/audit-logs", "审计日志"],
  ["/commerce", "商城后台"],
] as const;

async function logout(): Promise<void> {
  try { await api.post("/auth/logout"); } catch { /* local logout remains safe */ }
  clearAdminToken();
  ElMessage.success("已退出");
  await router.replace("/login");
}
</script>

<template>
  <el-container class="shell">
    <el-aside width="220px" class="aside">
      <div class="brand">Saydian赛电</div>
      <el-menu router :default-active="route.path" background-color="#17202c" text-color="#c7d0dc" active-text-color="#ffffff">
        <el-menu-item v-for="item in items" :key="item[0]" :index="item[0]">{{ item[1] }}</el-menu-item>
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
.aside { background: #17202c; }
.brand { height: 64px; display: grid; place-items: center; color: white; font-size: 20px; font-weight: 700; }
.header { background: white; border-bottom: 1px solid #e5e9ef; display: flex; align-items: center; justify-content: space-between; }
.el-main { padding: 0; }
</style>
