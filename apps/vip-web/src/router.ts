import { createRouter, createWebHistory } from "vue-router";
import { partnerTokenKey } from "./api";
import { ElMessageBox } from "element-plus";
const Login = () => import("./views/Login.vue");
const Shell = () => import("./views/Shell.vue");
const Dashboard = () => import("./views/Dashboard.vue");
const Promotion = () => import("./views/Promotion.vue");
const Members = () => import("./views/Members.vue");
const Products = () => import("./views/Products.vue");
const Orders = () => import("./views/Orders.vue");
const Certificate = () => import("./views/Certificate.vue");
const Finance = () => import("./views/Finance.vue");
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
router.onError(() => {
  void ElMessageBox.confirm(
    "页面加载失败，请检查网络后刷新重试。",
    "暂时无法打开",
    { confirmButtonText: "刷新页面", cancelButtonText: "留在当前页" },
  )
    .then(() => location.reload())
    .catch(() => {});
});
