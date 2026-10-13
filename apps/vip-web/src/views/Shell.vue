<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, data, errorMessage, partnerTokenKey } from "../api";
import { ElMessage } from "element-plus";
const route = useRoute(),
  router = useRouter(),
  profile = ref<any>(),
  open = ref(false);
const menu = [
  { path: "/", title: "平台概览", icon: "◈" },
  { path: "/promotion", title: "专属推广", icon: "▣" },
  { path: "/members", title: "会员与健康档案", icon: "◎" },
  { path: "/products", title: "分销采购", icon: "▦" },
  { path: "/orders", title: "采购订单", icon: "≡" },
  { path: "/wallet", title: "余额与充值", icon: "◉" },
  { path: "/ledger", title: "资金流水", icon: "↕" },
  { path: "/deposit", title: "保证金", icon: "◇" },
];
onMounted(async () => {
  try {
    profile.value = data(await api.get("/auth/me"));
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
});
async function logout() {
  try {
    await api.post("/auth/logout");
  } finally {
    sessionStorage.removeItem(partnerTokenKey);
    await router.replace("/login");
  }
}
function active(path: string) {
  return path === "/"
    ? route.path === "/"
    : route.path.startsWith(path) ||
        (path === "/wallet" && route.path.startsWith("/recharges"));
}
</script>
<template>
  <div class="layout">
    <aside :class="['sidebar', { open }]">
      <router-link to="/" class="brand"
        ><b>SAYDIAN <span>赛电</span></b
        ><small>品牌伙伴平台</small></router-link
      >
      <div class="sidebar-label">工作空间</div>
      <nav>
        <router-link
          v-for="item in menu"
          :key="item.path"
          :to="item.path"
          :class="{ selected: active(item.path) }"
          @click="open = false"
          ><span>{{ item.icon }}</span
          >{{ item.title }}</router-link
        >
      </nav>
      <div class="sidebar-foot">
        赛电品牌伙伴平台<br /><span>共享健康 · 携手成长</span>
      </div>
    </aside>
    <div v-if="open" class="overlay" @click="open = false"></div>
    <div class="workspace">
      <header class="topbar">
        <button class="menu-toggle" @click="open = !open" aria-label="展开菜单">
          ☰</button
        ><span>赛电品牌伙伴平台</span>
        <div class="identity">
          <span>{{ profile?.name || "品牌伙伴" }}</span
          ><el-tag v-if="profile?.level" type="info" size="small">{{
            profile.level.name
          }}</el-tag
          ><el-button text @click="logout">退出</el-button>
        </div>
      </header>
      <main><router-view /></main>
      <footer>赛电 SAYDIAN · 品牌伙伴专属服务</footer>
    </div>
  </div>
</template>
<style scoped>
.layout {
  min-height: 100vh;
}
.sidebar {
  width: 228px;
  position: fixed;
  inset: 0 auto 0 0;
  background: #18212e;
  color: #b9c2ce;
  z-index: 30;
  display: flex;
  flex-direction: column;
}
.brand {
  padding: 30px 24px 32px;
  color: white;
}
.brand b {
  font-size: 20px;
  letter-spacing: 1.5px;
}
.brand b span {
  font-size: 15px;
  letter-spacing: 0;
  margin-left: 4px;
  color: #eb9aa7;
}
.brand small {
  display: block;
  font-size: 12px;
  color: #9ca9bc;
  margin-top: 10px;
  letter-spacing: 2px;
}
.sidebar-label {
  font-size: 11px;
  color: #66778e;
  margin: 4px 26px 14px;
}
nav {
  padding: 0 13px;
}
nav a {
  display: flex;
  gap: 12px;
  align-items: center;
  color: #b8c2d0;
  padding: 14px 14px;
  font-size: 14px;
  border-radius: 8px;
  margin-bottom: 5px;
}
nav a span {
  width: 19px;
  text-align: center;
  font-size: 17px;
  color: #8597ae;
}
nav a:hover {
  background: #243144;
}
nav a.selected {
  background: #c9223b;
  color: white;
}
nav a.selected span {
  color: white;
}
.sidebar-foot {
  margin-top: auto;
  padding: 25px;
  border-top: 1px solid #283346;
  font-size: 12px;
  line-height: 1.9;
  color: #9ba8ba;
}
.sidebar-foot span {
  font-size: 11px;
  color: #5c6c82;
}
.workspace {
  margin-left: 228px;
}
.topbar {
  height: 74px;
  background: white;
  border-bottom: 1px solid #e8ebf1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 32px;
  font-size: 14px;
}
.identity {
  display: flex;
  align-items: center;
  gap: 12px;
}
.workspace main {
  padding: 32px;
  min-height: calc(100vh - 126px);
}
.workspace footer {
  font-size: 11px;
  color: #a0a8b6;
  text-align: center;
  padding: 16px;
}
.menu-toggle {
  display: none;
  border: 0;
  background: transparent;
  font-size: 22px;
}
.overlay {
  position: fixed;
  inset: 0;
  background: #0006;
  z-index: 25;
}
@media (max-width: 950px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.2s;
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .workspace {
    margin-left: 0;
  }
  .menu-toggle {
    display: block;
  }
  .topbar {
    padding: 0 16px;
  }
  .topbar > span {
    display: none;
  }
  .workspace main {
    padding: 22px 16px;
  }
  .identity {
    gap: 7px;
  }
}
</style>
