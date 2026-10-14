import {
  House,
  Share,
  User,
  ShoppingCart,
  Box,
  Wallet,
  Tickets,
  Lock,
  DocumentChecked,
} from "@element-plus/icons-vue";
export const menu = [
  { path: "/", title: "首页", icon: House },
  { path: "/promotion", title: "推广二维码", icon: Share },
  { path: "/members", title: "我的会员", icon: User },
  { path: "/products", title: "商品采购", icon: ShoppingCart },
  { path: "/orders", title: "我的订单", icon: Box },
  { path: "/wallet", title: "余额充值", icon: Wallet },
  { path: "/ledger", title: "收支明细", icon: Tickets },
  { path: "/deposit", title: "保证金", icon: Lock },
  { path: "/certificate", title: "电子授权证书", icon: DocumentChecked },
];
export function activeShortcut(path: string, current: string) {
  return path === "/wallet"
    ? ["/wallet", "/ledger", "/deposit"].includes(current) ||
        current.startsWith("/recharges")
    : activeMenu(path, current);
}
export function activeMenu(path: string, current: string) {
  return path === "/"
    ? current === "/"
    : current === path ||
        (path === "/wallet" && current.startsWith("/recharges"));
}
export function safeReturnPath(value: unknown) {
  if (typeof value !== "string") return "/";
  return /^(?:\/(?:promotion|members|products|orders|wallet|ledger|deposit|certificate)?|\/recharges\/[a-f0-9-]{36})$/.test(
    value,
  )
    ? value
    : "/";
}
