import "dotenv/config";
import { AdminRole, IntegrationState, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim() || "admin";
  const displayName =
    process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME?.trim() || "系统管理员";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "";
  if (password.length < 12) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD must contain at least 12 characters");
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

  for (const [key, publicConfig] of [
    ["sms", { provider: null }],
    ["push", { provider: null }],
    ["ai", { provider: null }],
    ["object_storage", { provider: "s3_compatible" }],
    ["commerce", { mode: "existing_saydian_mall" }],
  ] as const) {
    await prisma.integrationConfig.upsert({
      where: { key },
      create: {
        key,
        state:
          key === "commerce" || key === "object_storage"
            ? IntegrationState.CONFIGURED
            : IntegrationState.UNCONFIGURED,
        publicConfig,
      },
      update: { publicConfig },
    });
  }

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
      contentHtml: "<p>此为本地预发布示例协议，正式发布前须由法务审核并替换。</p>",
    },
    {
      documentType: "privacy_policy",
      title: "隐私政策",
      contentHtml: "<p>此为本地预发布示例政策，正式发布前须完成隐私合规审核并替换。</p>",
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
}

void main()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Seed failed"}\n`);
    process.exitCode = 1;
  });
