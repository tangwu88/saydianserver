import { createRouter, createWebHistory } from "vue-router";
import { clearAdminToken, ensureAdminRoles, getAdminRoles, hasAdminToken } from "./api";
import { canAdminResource } from "@saydian/app-contracts";
import AppShell from "./views/AppShell.vue";
import DashboardView from "./views/DashboardView.vue";
import LoginView from "./views/LoginView.vue";
import ResourceView from "./views/ResourceView.vue";
import ApiDocsView from "./views/ApiDocsView.vue";
import CommerceWithdrawalsView from "./views/CommerceWithdrawalsView.vue";
import IntegrationsView from "./views/IntegrationsView.vue";

const routes = [
  { path: "/login", component: LoginView },
  {
    path: "/",
    component: AppShell,
    children: [
      { path: "", component: DashboardView },
      { path: "api-docs", component: ApiDocsView },
      { path: "commerce-withdrawals", component: CommerceWithdrawalsView },
      { path: "integrations", component: IntegrationsView },
      { path: ":resource", component: ResourceView },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach(async (to) => {
  if (to.path !== "/login" && !hasAdminToken()) return "/login";
  if (to.path === "/login" && hasAdminToken()) return "/";
  if (to.path !== "/login") {
    try { await ensureAdminRoles(); }
    catch { clearAdminToken(); return "/login"; }
    const resource = to.path.split("/").filter(Boolean)[0] ?? "dashboard";
    if (to.path !== "/" && !canAdminResource(getAdminRoles(), resource, "read")) return "/";
  }
  return true;
});
