import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(import.meta.dirname, "../src");
const read = (path) => readFileSync(resolve(source, path), "utf8");

test("member avatars, tab icons and fixed product actions are present in both storefront modes", () => {
  assert.match(read("components/GlobalAccount.vue"), /v-if="user\?\.avatarUrl"/);
  assert.match(read("pages/profile/index.vue"), /v-if="user\?\.avatarUrl"/);
  const pages = JSON.parse(read("pages.json"));
  assert.equal(pages.tabBar.list.length, 4);
  for (const item of pages.tabBar.list) {
    assert.match(item.iconPath, /^static\/tab-[a-z-]+\.svg$/);
    assert.match(item.selectedIconPath, /^static\/tab-[a-z-]+-active\.svg$/);
  }
  const product = read("pages/product/index.vue");
  assert.match(product, /class="fixed-buy-bar"/);
  assert.match(product, /\.fixed-buy-bar\{position:fixed/);
  for (const label of ["收藏", "加入购物车", "立即购买"]) assert.match(product, new RegExp(label));
});

test("coupon gifts produce a poster, survive login and are visible during checkout", () => {
  const employee = read("pages/employee/index.vue");
  assert.match(employee, />生成分享券</);
  assert.match(employee, /buildCouponPoster/);
  assert.match(employee, />优惠券海报</);
  const gift = read("pages/coupon-gift/index.vue");
  assert.match(gift, /登录后领取/);
  assert.match(gift, /requireLogin\(`\/pages\/coupon-gift\/index\?token=/);
  assert.match(read("pages/checkout/index.vue"), /showBenefits=ref\(true\)/);
});

test("home categories stay in one horizontal row and keep the all-products action right aligned", () => {
  const home = read("pages/home/index.vue");
  assert.match(home, /class="category-icon"/);
  assert.match(home, /border-radius:16px/);
  assert.match(home, /\.catalog-side \{ display:flex; flex-wrap:nowrap/);
  assert.match(home, /overflow-x:auto/);
  assert.match(home, /\.section-title>text\{flex:1/);
  assert.match(home, /margin:0 0 0 auto!important/);
});

test("withdrawal form captures payout details and explains the frozen commission lifecycle", () => {
  const panel = read("components/EmployeeWithdrawalPanel.vue");
  for (const field of ["payoutMethod", "accountName", "payoutAccount", "bankName"]) assert.match(panel, new RegExp(field));
  assert.match(panel, /有可用佣金即可申请/);
  assert.match(panel, /后台审核通过后显示为已提现/);
  assert.match(panel, /已提交，佣金已冻结/);
  assert.match(panel, /SUCCEEDED: "已提现"/);
});
