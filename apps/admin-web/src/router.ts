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
import PartnersView from "./views/PartnersView.vue";
import UsMigrationView from "./views/UsMigrationView.vue";

const routes = [
  { path: "/login", component: LoginView },
  { path: "/health-screen", component: () => import("./views/MemberHealthScreenView.vue"), meta: { public: true } },
  { path: "/members/:id/health-screen", component: () => import("./views/MemberHealthScreenView.vue"), meta: { resource: "member-health-analysis" } },
  {
    path: "/",
    component: AppShell,
    children: [
      { path: "", component: DashboardView },
      { path: "health-score-rules", component: () => import("./views/HealthScoreRulesView.vue") },
      { path: "api-docs", component: ApiDocsView },
      { path: "commerce-withdrawals", component: CommerceWithdrawalsView },
      { path: "integrations", component: IntegrationsView },
      { path: "commerce-gifts", component: () => import("./views/CommerceGiftsView.vue") },
      { path: "us-migration", component: UsMigrationView },
      ...["partner-applications", "partner-agreements"].map(path => ({ path, component: () => import("./views/PartnerOnboardingView.vue") })),
      ...["partners", "partner-levels", "partner-prices", "partner-finance"].map(path => ({ path, component: PartnersView })),
      { path: ":resource", component: ResourceView },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach(async (to) => {
  if (to.path === "/health-screen" || /^\/members\/[^/]+\/health-screen\/?$/.test(to.path)) return true;
  if (to.path !== "/login" && !hasAdminToken()) return "/login";
  if (to.path === "/login" && hasAdminToken()) return "/";
  if (to.path !== "/login") {
    try { await ensureAdminRoles(); }
    catch { clearAdminToken(); return "/login"; }
    const resource = typeof to.meta.resource === "string" ? to.meta.resource : to.path.split("/").filter(Boolean)[0] ?? "dashboard";
    if (to.path !== "/" && !canAdminResource(getAdminRoles(), resource, "read")) return "/";
  }
  return true;
});
