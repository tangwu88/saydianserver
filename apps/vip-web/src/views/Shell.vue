<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Menu, SwitchButton } from "@element-plus/icons-vue";
import { api, data, errorMessage, partnerTokenKey } from "../api";
import { ElMessage } from "element-plus";
import { menu, activeMenu, activeShortcut } from "../navigation";
import AgreementGate from "../components/AgreementGate.vue";
import PasswordGate from "../components/PasswordGate.vue";
const passwordReady = ref(false);
const agreementReady = ref(false);
const route = useRoute(),
  router = useRouter(),
  profile = ref<any>(),
  open = ref(false),
  leaving = ref(false);
const currentTitle = computed(
  () =>
    menu.find((item) => activeMenu(item.path, route.path))?.title ||
    (route.path === "/certificate" ? "电子授权证书" : "品牌伙伴平台"),
);
const shortcuts = menu.filter((item) =>
  ["/", "/products", "/orders", "/wallet"].includes(item.path),
);
const shortcutLabels: Record<string, string> = {
  "/": "首页",
  "/products": "采购",
  "/orders": "订单",
  "/wallet": "余额",
};
const moreSelected = computed(
  () => !shortcuts.some((item) => activeShortcut(item.path, route.path)),
);
onMounted(async () => {
  try {
    profile.value = data(await api.get("/auth/me"));
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  }
});
async function logout() {
  if (leaving.value) return;
  leaving.value = true;
  try {
    await api.post("/auth/logout");
  } catch (cause) {
    ElMessage.error(errorMessage(cause));
  } finally {
    sessionStorage.removeItem(partnerTokenKey);
    await router.replace("/login");
    leaving.value = false;
  }
}
</script>
<template>
  <div class="layout">
    <aside class="sidebar">
      <router-link to="/" class="brand"
        ><b>SAYDIAN <span>赛电</span></b
        ><small>品牌伙伴平台</small></router-link
      >
      <nav aria-label="主导航">
        <router-link
          v-for="item in menu"
          :key="item.path"
          :to="item.path"
          :class="{ selected: activeMenu(item.path, route.path) }"
          :aria-current="activeMenu(item.path, route.path) ? 'page' : undefined"
          ><el-icon><component :is="item.icon" /></el-icon
          >{{ item.title }}</router-link
        >
      </nav>
    </aside>
    <el-drawer
      v-model="open"
      title="全部功能"
      direction="ltr"
      size="min(320px, 92vw)"
      class="navigation-drawer"
    >
      <div class="drawer-account">
        <b>{{ profile?.name || "品牌伙伴" }}</b>
        <el-tag v-if="profile?.level" type="info">{{
          profile.level.name
        }}</el-tag>
      </div>
      <nav class="drawer-nav" aria-label="全部功能">
        <router-link
          v-for="item in menu"
          :key="item.path"
          :to="item.path"
          :class="{ selected: activeMenu(item.path, route.path) }"
          @click="open = false"
          ><el-icon><component :is="item.icon" /></el-icon
          >{{ item.title }}</router-link
        >
      </nav>
      <el-button
        class="drawer-logout"
        :icon="SwitchButton"
        :loading="leaving"
        @click="logout"
        >退出登录</el-button
      >
    </el-drawer>
    <div class="workspace">
      <header class="topbar">
        <div class="topbar-title">
          <el-button
            class="menu-toggle"
            :icon="Menu"
            text
            aria-label="打开全部功能"
            :aria-expanded="open"
            @click="open = true"
          /><b>{{ currentTitle }}</b>
        </div>
        <div class="identity">
          <span>{{ profile?.name || "品牌伙伴" }}</span
          ><el-tag v-if="profile?.level" type="info" size="small">{{
            profile.level.name
          }}</el-tag
          ><el-button
            text
            :icon="SwitchButton"
            :loading="leaving"
            @click="logout"
            >退出</el-button
          >
        </div>
      </header>
      <nav class="mobile-shortcuts" aria-label="快捷导航">
        <router-link
          v-for="item in shortcuts"
          :key="item.path"
          :to="item.path"
          :class="{ selected: activeShortcut(item.path, route.path) }"
          :aria-current="
            activeShortcut(item.path, route.path) ? 'page' : undefined
          "
          :aria-label="item.title"
          ><el-icon><component :is="item.icon" /></el-icon
          >{{ shortcutLabels[item.path] }}</router-link
        >
        <button
          type="button"
          :class="{ selected: moreSelected }"
          :aria-expanded="open"
          aria-label="打开更多功能"
          @click="open = true"
        >
          <el-icon><Menu /></el-icon>更多
        </button>
      </nav>
      <main id="main-content"><PasswordGate @ready="passwordReady = $event; agreementReady = false" @logout="logout" /><AgreementGate v-if="passwordReady" @ready="agreementReady = $event" @logout="logout" /><router-view v-if="passwordReady && agreementReady" /></main>
    </div>
  </div>
</template>
<style scoped>
.layout {
  min-height: 100vh;
}
.sidebar {
  width: 208px;
  position: fixed;
  inset: 0 auto 0 0;
  background: #18212e;
  color: #bec8d5;
  z-index: 30;
  overflow-y: auto;
}
.brand {
  display: block;
  padding: 28px 22px;
  color: #fff;
}
.brand b {
  font-size: 20px;
  letter-spacing: 1px;
}
.brand b span {
  font-size: 14px;
  color: #eb9aa7;
}
.brand small {
  display: block;
  font-size: 12px;
  color: #b6c1d0;
  margin-top: 9px;
}
nav {
  padding: 8px 12px;
}
nav a {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 13px 14px;
  border-radius: 8px;
  margin-bottom: 5px;
  color: inherit;
  font-size: 15px;
}
nav .el-icon {
  font-size: 20px;
}
nav a:hover {
  background: #243144;
}
nav a.selected {
  background: #c9223b;
  color: #fff;
}
.workspace {
  margin-left: 208px;
}
.topbar {
  min-height: 64px;
  background: #fff;
  border-bottom: 1px solid #e8ebf1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 28px;
}
.topbar-title,
.identity {
  display: flex;
  align-items: center;
  gap: 10px;
}
.identity {
  font-size: 14px;
}
.identity > span {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace main {
  padding: 28px;
  min-height: calc(100vh - 64px);
}
.menu-toggle,
.mobile-shortcuts {
  display: none;
}
.drawer-nav {
  color: #18212f;
}
.drawer-account {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding: 0 14px 18px;
  overflow-wrap: anywhere;
}
.drawer-logout {
  width: 100%;
  margin-top: 14px;
}
.drawer-nav a:hover {
  background: #fcebed;
}
.drawer-nav a.selected:hover {
  background: #c9223b;
}
@media (max-width: 950px) {
  .sidebar {
    display: none;
  }
  .workspace {
    margin-left: 0;
  }
  .menu-toggle {
    display: inline-flex;
  }
  .topbar {
    padding: 8px 14px;
  }
  .workspace main {
    padding: 20px 16px;
  }
  .mobile-shortcuts {
    display: flex;
    justify-content: space-around;
    background: #fff;
    border-bottom: 1px solid #e8ebf1;
    padding: 6px;
  }
  .mobile-shortcuts a {
    flex-direction: column;
    gap: 5px;
    padding: 8px 6px;
    margin: 0;
    font-size: 12px;
    flex: 1;
  }
  .mobile-shortcuts button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    flex: 1;
    padding: 8px 6px;
    border: 0;
    border-radius: 8px;
    font-size: 12px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .mobile-shortcuts a:hover {
    background: #fcebed;
  }
  .mobile-shortcuts a.selected {
    background: #fcebed;
    color: #b82237;
  }
  .identity .el-tag {
    display: none;
  }
}
@media (max-width: 420px) {
  .identity > span {
    max-width: 82px;
  }
  .identity {
    gap: 3px;
  }
  .topbar-title {
    gap: 2px;
  }
}
@media (max-width: 600px), (max-width: 950px) and (max-height: 500px) {
  .layout {
    min-height: 100svh;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 30;
    min-height: calc(56px + env(safe-area-inset-top));
    padding: calc(6px + env(safe-area-inset-top)) 12px 6px;
  }
  .topbar-title {
    min-width: 0;
    gap: 4px;
  }
  .topbar-title b {
    font-size: 16px;
  }
  .menu-toggle {
    width: 44px;
    padding: 0;
    font-size: 20px;
  }
  .identity > span {
    max-width: 100px;
    font-size: 12px;
  }
  .identity > .el-button {
    display: none;
  }
  .workspace main {
    padding: 18px 14px calc(92px + env(safe-area-inset-bottom));
    min-height: calc(100svh - 56px);
  }
  .mobile-shortcuts {
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    border-top: 1px solid #e8ebf1;
    border-bottom: 0;
    box-shadow: 0 -4px 18px #18212f08;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
    gap: 4px;
  }
  .mobile-shortcuts a,
  .mobile-shortcuts button {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 54px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 5px 0;
    margin: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #637084;
    font-size: 11px;
    cursor: pointer;
  }
  .mobile-shortcuts .el-icon {
    font-size: 22px;
  }
  .mobile-shortcuts .selected {
    color: #b82237;
    background: #fcebed;
    font-weight: 600;
  }
  .drawer-nav {
    padding: 0;
  }
}
@media (min-width: 601px) and (max-width: 950px) and (max-height: 500px) {
  .workspace main {
    padding-top: 10px;
  }
}
</style>
