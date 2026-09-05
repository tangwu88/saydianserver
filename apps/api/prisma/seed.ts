import "dotenv/config";
import { AdminRole, IntegrationState, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import {
  hasConfiguredAlipay,
  hasConfiguredCommerce,
  hasConfiguredObjectStorage,
  hasConfiguredWechatPay,
  hasConfiguredWeCom,
  shouldSeedPreviewContent,
} from "./seed-policy";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim() || "admin";
  const displayName =
    process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME?.trim() || "系统管理员";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "";
  if (password.length < 12) {
    throw new Error(
      "ADMIN_BOOTSTRAP_PASSWORD must contain at least 12 characters",
    );
  }
  await prisma.adminUser.upsert({
    where: { username },
    create: {
      username,
      displayName,
      passwordHash: await hash(password, 12),
      role: AdminRole.SUPER_ADMIN,
    },
    update: { displayName, active: true },
  });

  for (const [key, state, publicConfig] of [
    ["sms", IntegrationState.UNCONFIGURED, { provider: null }],
    ["push", IntegrationState.UNCONFIGURED, { provider: null }],
    ["ai", IntegrationState.UNCONFIGURED, { provider: null }],
    [
      "wechat_pay",
      hasConfiguredWechatPay()
        ? IntegrationState.CONFIGURED
        : IntegrationState.UNCONFIGURED,
      { provider: "wechat_pay_v3" },
    ],
    [
      "alipay",
      hasConfiguredAlipay()
        ? IntegrationState.CONFIGURED
        : IntegrationState.UNCONFIGURED,
      { provider: "alipay_open_platform" },
    ],
    ["apple_iap", IntegrationState.UNCONFIGURED, { provider: "storekit_2" }],
    [
      "wecom",
      hasConfiguredWeCom()
        ? IntegrationState.CONFIGURED
        : IntegrationState.UNCONFIGURED,
      {
        provider: "enterprise_wechat",
        storefrontUrl: process.env.COMMERCE_STOREFRONT_URL?.trim() || null,
        corpId: process.env.WECOM_CORP_ID?.trim() || null,
        agentId: process.env.WECOM_AGENT_ID?.trim() || null,
        allowedRedirectHosts: (process.env.WECOM_ALLOWED_REDIRECT_HOSTS ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      },
    ],
    ["jushuitan", IntegrationState.UNCONFIGURED, { authority: "sku_inventory_fulfillment" }],
    [
      "object_storage",
      hasConfiguredObjectStorage()
        ? IntegrationState.CONFIGURED
        : IntegrationState.UNCONFIGURED,
      { provider: "s3_compatible" },
    ],
    [
      "commerce",
      hasConfiguredCommerce()
        ? IntegrationState.CONFIGURED
        : IntegrationState.UNCONFIGURED,
      { mode: "integrated", sourceCommit: "09963c49f255c146ffab2bfd17b8d0961c655ebd" },
    ],
  ] as const) {
    await prisma.integrationConfig.upsert({
      where: { key },
      create: {
        key,
        state,
        publicConfig,
      },
      // Deployment restarts must not overwrite values entered in the
      // write-only integration center. Environment-derived defaults only
      // initialize a new database.
      update: {},
    });
  }

  if (shouldSeedPreviewContent()) {
    const category = await prisma.articleCategory.upsert({
      where: { legacyId: "3" },
      create: { legacyId: "3", name: "健康百科", sort: 100 },
      update: { name: "健康百科", enabled: true },
    });
    await prisma.article.upsert({
      where: { legacyId: "seed-health-guide" },
      create: {
        legacyId: "seed-health-guide",
        categoryId: category.id,
        title: "正确理解手表健康数据",
        summary: "健康数据用于日常趋势参考，明显不适请及时就医。",
        contentHtml:
          "<p>手表记录适合观察个人趋势，不用于诊断或治疗。测量前请按产品说明佩戴并保持安静；如有明显不适，请及时就医。</p>",
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      update: { categoryId: category.id },
    });

    for (const document of [
      {
        documentType: "user_agreement",
        title: "用户协议",
        contentHtml:
          "<p>此为本地预发布示例协议，正式发布前须由法务审核并替换。</p>",
      },
      {
        documentType: "privacy_policy",
        title: "隐私政策",
        contentHtml:
          "<p>此为本地预发布示例政策，正式发布前须完成隐私合规审核并替换。</p>",
      },
    ]) {
      await prisma.legalDocument.upsert({
        where: {
          documentType_version: {
            documentType: document.documentType,
            version: "local-preview-1",
          },
        },
        create: {
          ...document,
          version: "local-preview-1",
          active: true,
          publishedAt: new Date("2026-09-01T00:00:00.000Z"),
        },
        update: document,
      });
    }
  }

  await prisma.appSetting.upsert({
    where: { key: "support" },
    create: {
      key: "support",
      value: {
        configured: false,
        message: "客服渠道暂时无法使用，请稍后再试",
      },
      public: true,
    },
    update: {},
  });

  const salesEnabled = ["1", "true", "yes"].includes(
    (process.env.ENABLE_HEALTH_REPORT_SALES ?? "").trim().toLowerCase(),
  );
  const singlePrice = positiveInteger(process.env.HEALTH_REPORT_SINGLE_PRICE_CENTS);
  const membershipPrice = positiveInteger(
    process.env.HEALTH_MEMBERSHIP_PRICE_CENTS,
  );
  await prisma.healthReportOffer.upsert({
    where: { code: "single-report-v1" },
    create: {
      code: "single-report-v1",
      offerKey: "single-report",
      title: "单次详细健康报告",
      description: "购买后生成1份近30天AI健康管理参考报告",
      entitlement: "SINGLE_REPORT",
      priceCents: singlePrice,
      creditCount: 1,
      platforms: ["android", "ios", "h5", "mini_program", "web"],
      appleProductId: process.env.APPLE_IAP_SINGLE_REPORT_PRODUCT_ID?.trim() || null,
      active: salesEnabled && singlePrice > 0,
    },
    update: {
      priceCents: singlePrice,
      appleProductId: process.env.APPLE_IAP_SINGLE_REPORT_PRODUCT_ID?.trim() || null,
      active: salesEnabled && singlePrice > 0,
    },
  });
  await prisma.healthReportOffer.upsert({
    where: { code: "health-membership-30d-v1" },
    create: {
      code: "health-membership-30d-v1",
      offerKey: "health-membership-30d",
      title: "30天健康会员",
      description: "有效期30天，含4份详细健康管理参考报告，不自动续费",
      entitlement: "MEMBERSHIP",
      priceCents: membershipPrice,
      creditCount: 4,
      durationDays: 30,
      platforms: ["android", "ios", "h5", "mini_program", "web"],
      appleProductId: process.env.APPLE_IAP_MEMBERSHIP_PRODUCT_ID?.trim() || null,
      active: salesEnabled && membershipPrice > 0,
    },
    update: {
      priceCents: membershipPrice,
      appleProductId: process.env.APPLE_IAP_MEMBERSHIP_PRODUCT_ID?.trim() || null,
      active: salesEnabled && membershipPrice > 0,
    },
  });
}

function positiveInteger(value: string | undefined): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

void main()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Seed failed"}\n`,
    );
    process.exitCode = 1;
  });
