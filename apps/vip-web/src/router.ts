import { createRouter, createWebHistory } from "vue-router";
import { partnerTokenKey } from "./api";
import Login from "./views/Login.vue";
import Shell from "./views/Shell.vue";
import Dashboard from "./views/Dashboard.vue";
import Promotion from "./views/Promotion.vue";
import Members from "./views/Members.vue";
import Products from "./views/Products.vue";
import Orders from "./views/Orders.vue";
import Certificate from "./views/Certificate.vue";
import Finance from "./views/Finance.vue";
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: "/login", component: Login },
    {
      path: "/certificate/verify/:code",
      component: Certificate,
      meta: { public: true },
    },
    {
      path: "/",
      component: Shell,
      children: [
        { path: "", component: Dashboard },
        { path: "certificate", component: Certificate },
        { path: "promotion", component: Promotion },
        { path: "members", component: Members },
        { path: "products", component: Products },
        { path: "orders", component: Orders },
        { path: "wallet", component: Finance },
        { path: "ledger", component: Finance },
        { path: "deposit", component: Finance },
        { path: "recharges/:id?", component: Finance },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
router.beforeEach((to) => {
  const loggedIn = !!sessionStorage.getItem(partnerTokenKey);
  if (!to.meta.public && to.path !== "/login" && !loggedIn)
    return { path: "/login", query: { next: to.path } };
  if (to.path === "/login" && loggedIn) return "/";
  return true;
});
