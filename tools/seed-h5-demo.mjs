// Synthetic-only seed for the isolated H5 demo database; not the general seed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDemoSeedEnvironment } from "./h5-demo-profile.mjs";

validateDemoSeedEnvironment(process.env, fileURLToPath(new URL("..", import.meta.url)));
const sessionPath = process.env.H5_DEMO_SESSION_PATH;
assert.ok((process.env.EMPLOYEE_TOKEN_SECRET ?? "").length >= 32 && (process.env.H5_DEMO_ADMIN_PASSWORD ?? "").length >= 16, "Demo secrets missing");
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const { sign } = require("jsonwebtoken");
const prisma = new PrismaClient();
const id = name => {
  const h = createHash("sha256").update("saydian-h5-demo-v1:" + name).digest("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32);
};
// Images were individually observed on www.saidian.cc. Prices/stock are invented
// demonstration fixtures, never official price or efficacy representations.
const catalog = [
  ["FF2100", "/d/file/p/2026/06-04/58b4b79f8dc6dc47b94b41280b7ecc4c.png"],
  ["R7青春版", "/d/file/p/2026/05-09/3ff0af773292f7f1f617c31894ee4dc3.png"],
  ["R7", "/d/file/p/2026/05-09/d32064b98ec2f945b687a5413aa7e6a5.png"],
  ["W8 Ultra-R", "/d/file/p/2026/05-09/0d71386418353d04bdf709c558be1418.png"],
  ["W8 Ultra", "/d/file/p/2026/03-10/04a6610c8d8339941444376fa055b1c4.png"],
  ["W8S", "/d/file/p/2026/03-10/7911a686806de8fd1b8580dd899a55be.png"],
];
try {
  assert.equal(await prisma.integrationSecret.count(), 0, "Demo database must not contain provider secrets");
  assert.equal(await prisma.integrationConfig.count({ where: { state: "CONFIGURED" } }), 0, "Demo integrations must remain unconfigured");
  await prisma.$transaction(async tx => {
    for (const key of ["sms", "push", "ai", "wechat_login", "wechat_official", "wechat_pay", "wecom", "jushuitan", "alipay", "apple_iap", "object_storage"]) {
      await tx.integrationConfig.upsert({ where: { key }, create: { key, state: "UNCONFIGURED", publicConfig: {} }, update: {} });
    }
    await tx.adminUser.upsert({ where: { username: process.env.H5_DEMO_ADMIN_USERNAME || "h5-demo-admin" },
      create: { id: id("admin"), username: process.env.H5_DEMO_ADMIN_USERNAME || "h5-demo-admin", displayName: "H5隔离演示管理员",
        passwordHash: await hash(process.env.H5_DEMO_ADMIN_PASSWORD, 12), role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] }, update: {} });
    await tx.commerceCategory.upsert({ where: { id: id("category") }, create: { id: id("category"), name: "智能穿戴 · 演示", sort: 100, enabled: true }, update: {} });
    for (const [index, [model, path]] of catalog.entries()) {
      const productId = id("product:" + model), skuId = id("sku:" + model);
      const image = "https://www.saidian.cc" + path;
      const erpItemId = "H5-DEMO-LOCAL-" + index;
      await tx.commerceProduct.upsert({ where: { id: productId }, create: {
        id: productId, erpItemId, source: "LOCAL", name: model, displayName: model,
        subtitle: "演示商品：价格与库存仅供测试，不代表正式销售数据", brand: "Saydian赛电",
        coverImage: image, gallery: [image], tags: ["演示数据", "测试价格"], categoryId: id("category"),
        detailHtml: "<p>本商品用于本地界面与流程演示，价格、库存均为合成测试数据。图片来自已核对的品牌官网；不构成功效承诺。</p>",
        status: "PUBLISHED", featured: true, sort: 100 - index,
      }, update: {} });
      await tx.commerceSku.upsert({ where: { id: skuId }, create: {
        id: skuId, productId, erpItemId, erpSkuId: "H5-DEMO-LOCAL-SKU-" + index, specification: "演示规格",
        image, salePriceCents: 19900 + index * 10000, stock: 20, enabled: true,
      }, update: {} });
    }
    await tx.commerceBanner.upsert({ where: { id: id("banner") }, create: {
      id: id("banner"), title: "赛电智能穿戴 · 本地演示", imageUrl: "https://www.saidian.cc" + catalog[0][1],
      targetUrl: "/pages/product/index?id=" + id("product:FF2100"), enabled: true, sort: 100,
    }, update: {} });
    await tx.commerceEmployee.upsert({ where: { id: id("employee") }, create: {
      id: id("employee"), wecomUserId: "H5-DEMO-NOT-REAL-WECOM", name: "演示员工", referralCode: "H5DEMO",
      departmentNames: ["隔离演示"], active: true,
    }, update: {} });
    await tx.commerceEmployeeWallet.upsert({ where: { employeeId: id("employee") },
      create: { employeeId: id("employee") }, update: {} });
    await tx.user.upsert({ where: { id: id("member") }, create: {
      id: id("member"), mobile: "19900000001", nickname: "演示会员", referralEmployeeId: id("employee"),
    }, update: {} });
    await tx.commerceCommissionPlan.upsert({ where: { id: "default" }, create: {
      id: "default", enabled: false, withdrawalEnabled: false, minimumWithdrawCents: null,
      dailyWithdrawLimitCents: null, reviewRequired: true,
    }, update: {} });
    await tx.commerceCoupon.upsert({ where: { id: id("coupon") }, create: {
      id: id("coupon"), name: "演示券 · 测试满100减10", type: "CASH", status: "ACTIVE", value: 1000,
      minimumSpendCents: 10000, totalQuantity: 100, claimedQuantity: 1, employeeDistributable: true, perEmployeeLimit: 10, employeeClaimBatchSize: 1,
      validFrom: new Date("2026-01-01T00:00:00Z"), validUntil: new Date("2099-01-01T00:00:00Z"),
    }, update: {} });
    const pointSeedKey = 'h5-demo-fixtures-v1-points';
    if (!await tx.commercePointLedger.findUnique({ where: { idempotencyKey: pointSeedKey } })) {
      await tx.commercePointAccount.upsert({ where: { userId: id('member') }, create: { userId: id('member'), balanceCents: 5000 }, update: { balanceCents: { increment: 5000 }, version: { increment: 1 } } });
      await tx.commercePointLedger.create({ data: { userId: id('member'), deltaCents: 5000, type: 'DEMO_TEST_CREDIT', idempotencyKey: pointSeedKey } });
    }
    await tx.commerceCouponClaim.upsert({ where: { couponId_userId: { couponId: id("coupon"), userId: id("member") } },
      create: { couponId: id("coupon"), userId: id("member"), sourceEmployeeId: id("employee") }, update: {} });
    await tx.commerceBusinessConfig.upsert({ where: { key: "store.notice" },
      create: { key: "store.notice", label: "演示提示", enabled: true, value: { text: "隔离演示环境 · 商品价格和库存为测试数据 · 不发短信、不支付、不打款" } }, update: {} });
  }, { timeout: 60_000 });
  const token = sign({ sub: id("employee"), typ: "employee" }, process.env.EMPLOYEE_TOKEN_SECRET,
    { algorithm: "HS256", expiresIn: "2h", issuer: "saydianapp-server", audience: "saydian-commerce-employee" });
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, JSON.stringify({ scope: "isolated-loopback-demo", employeeId: id("employee"), token,
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ seeded: true, database: "saydian_h5_demo", products: 6, source: "LOCAL", integrations: "UNCONFIGURED",
    memberMobile: "19900000001", testOtp: "123456", employeeSession: "written to private runtime file; token withheld", idempotent: true }));
} finally { await prisma.$disconnect(); }
