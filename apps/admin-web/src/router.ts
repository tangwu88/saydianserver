import { createRouter, createWebHistory } from "vue-router";
import { hasAdminToken } from "./api";
import AppShell from "./views/AppShell.vue";
import DashboardView from "./views/DashboardView.vue";
import LoginView from "./views/LoginView.vue";
import ResourceView from "./views/ResourceView.vue";

const routes = [
  { path: "/login", component: LoginView },
  {
    path: "/",
    component: AppShell,
    children: [
      { path: "", component: DashboardView },
      { path: ":resource", component: ResourceView },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach((to) => {
  if (to.path !== "/login" && !hasAdminToken()) return "/login";
  if (to.path === "/login" && hasAdminToken()) return "/";
  return true;
});
