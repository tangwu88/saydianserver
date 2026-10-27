// Isolated local-only preview. Never reads a production .env or starts a worker.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  local = join(root, "artifacts/gift-redemption-20261027"),
  file = join(local, "preview-private.json");
const require = createRequire(join(root, "apps/api/package.json")),
  { PrismaClient } = require("@prisma/client"),
  { hash } = require("bcryptjs");
const action = process.argv[2],
  database = "postgresql://gift_dev@127.0.0.1:55437/saydian_gift_preview";
if (!["prepare", "api", "admin", "shop"].includes(action))
  throw new Error("Use prepare, api, admin or shop");
if (action === "prepare") {
  await mkdir(local, { recursive: true });
  if (existsSync(file)) {
    console.log(
      "Existing preview profile retained; credentials are in the private local file.",
    );
    process.exit(0);
  }
  const bootstrap = new PrismaClient({
    datasources: {
      db: { url: "postgresql://gift_dev@127.0.0.1:55437/postgres" },
    },
  });
  const existing =
    await bootstrap.$queryRaw`SELECT datname FROM pg_database WHERE datname='saydian_gift_preview'`;
  if (!existing.length)
    await bootstrap.$executeRawUnsafe('CREATE DATABASE "saydian_gift_preview"');
  await bootstrap.$disconnect();
  const env = {
    NODE_ENV: "development",
    DATABASE_URL: database,
    HOST: "127.0.0.1",
    PORT: "18087",
    PUBLIC_BASE_URL: "http://127.0.0.1:5197/",
    CORS_ORIGINS: "http://127.0.0.1:5197,http://127.0.0.1:3308",
    ACCESS_TOKEN_SECRET: randomBytes(48).toString("base64url"),
    REFRESH_TOKEN_PEPPER: randomBytes(48).toString("base64url"),
    INTEGRATION_MASTER_KEY: randomBytes(32).toString("hex"),
    ALLOW_TEST_OTP: "true",
    SMS_PROVIDER: "disabled",
    COMMERCE_MODE: "integrated",
    DEPLOYMENT_SITE: "cn",
    MAINTENANCE_READ_ONLY: "false",
    BUSINESS_WRITES_PAUSED: "false",
    WORKER_OUTBOUND_PAUSED: "true",
    CALLBACK_PROCESSING_PAUSED: "true",
    DOTENV_CONFIG_PATH: "/dev/null",
    DOTENV_CONFIG_QUIET: "true",
    TS_NODE_PROJECT: join(root, "apps/api/tsconfig.json"),
    VITE_API_PROXY_TARGET: "http://127.0.0.1:18087",
    VITE_PUBLIC_BASE: "/global/saidian-mall/",
    VITE_API_BASE: "/global/api/saidian-mall/v1",
  };
  await new Promise((done, reject) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@saydian/app-api", "exec", "prisma", "migrate", "deploy"],
      { cwd: root, env: { PATH: process.env.PATH, ...env }, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? done() : reject(new Error("Preview migration failed")),
    );
  });
  const prisma = new PrismaClient({ datasources: { db: { url: database } } });
  if (
    (await prisma.user.count()) ||
    (await prisma.adminUser.count()) ||
    (await prisma.commerceProduct.count())
  )
    throw new Error("Non-empty preview database retained; seed refused");
  const password = "GiftPreview-" + randomBytes(8).toString("hex"),
    opsPassword = "GiftOps-" + randomBytes(8).toString("hex");
  const product = await prisma.$transaction(async (tx) => {
    await tx.adminUser.create({
      data: {
        username: "gift-preview-admin",
        displayName: "礼品兑换本地管理员",
        passwordHash: await hash(password, 12),
        role: "SUPER_ADMIN",
        roles: ["SUPER_ADMIN"],
      },
    });
    await tx.adminUser.create({
      data: {
        username: "gift-preview-ops",
        displayName: "礼品兑换本地运营",
        passwordHash: await hash(opsPassword, 12),
        role: "COMMERCE_OPERATIONS",
        roles: ["COMMERCE_OPERATIONS"],
      },
    });
    const item = await tx.commerceProduct.create({
      data: {
        erpItemId: "LOCAL-GIFT-PREVIEW",
        name: "礼品兑换演示商品",
        source: "LOCAL",
        status: "PUBLISHED",
        coverImage:
          "/global/saidian-mall/static/catalog/17e342cb-b1da-4725-a046-8a7c7bb67b52.webp",
        gallery: [],
        tags: [],
        skus: {
          create: [
            {
              erpSkuId: "LOCAL-GIFT-PREVIEW-BLACK",
              erpItemId: "LOCAL-GIFT-PREVIEW",
              specification: "黑色 / 8号",
              salePriceCents: 68000,
              stock: 20,
            },
            {
              erpSkuId: "LOCAL-GIFT-PREVIEW-SILVER",
              erpItemId: "LOCAL-GIFT-PREVIEW",
              specification: "银色 / 9号",
              salePriceCents: 68000,
              stock: 20,
            },
          ],
        },
      },
    });
    await tx.appSetting.create({
      data: {
        key: "commerce_gift_redemption",
        public: false,
        value: { enabled: true },
      },
    });
    await tx.commerceBusinessConfig.create({
      data: {
        key: "global.markets",
        label: "本地礼品演示配送区域",
        enabled: true,
        value: {
          markets: [
            { countryCode: "CN", currency: "CNY", commerceEnabled: true },
          ],
        },
      },
    });
    for (const documentType of ["user_agreement", "privacy_policy"])
      await tx.globalLegalDocument.create({
        data: {
          documentType,
          version: "gift-preview-v1",
          locale: "en",
          title:
            documentType === "user_agreement"
              ? "本地演示用户协议"
              : "本地演示隐私说明",
          contentHtml:
            "<p>仅供本地合成验收，不作为线上条款；本地手机号、地址和订单用于演示兑换流程。</p>",
          reviewed: true,
          active: true,
          publishedAt: new Date(),
        },
      });
    return item;
  });
  await prisma.$disconnect();
  await writeFile(
    file,
    JSON.stringify(
      {
        env,
        admin: { username: "gift-preview-admin", password },
        operations: { username: "gift-preview-ops", password: opsPassword },
        productId: product.id,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Isolated preview ready. Private local credentials retained; SMS code is 123456, no external SMS/payment/ERP calls.",
  );
} else {
  const profile = JSON.parse(await readFile(file, "utf8")),
    safeEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      ...profile.env,
    };
  let command = process.execPath,
    args = [],
    cwd = root;
  if (action === "api")
    args = [
      "-r",
      require.resolve("ts-node/register/transpile-only"),
      join(root, "apps/api/src/main.ts"),
    ];
  if (action === "admin") {
    args = [
      join(root, "apps/admin-web/node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "3308",
      "--strictPort",
    ];
    cwd = join(root, "apps/admin-web");
  }
  if (action === "shop") {
    command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    args = [
      "--filter",
      "@saydian/app-shop",
      "dev:h5",
      "--host",
      "127.0.0.1",
      "--port",
      "5197",
      "--strictPort",
    ];
  }
  const child = spawn(command, args, { cwd, env: safeEnv, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.once("exit", (code) => process.exit(code ?? 1));
}
