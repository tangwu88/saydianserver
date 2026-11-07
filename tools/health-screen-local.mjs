// Local synthetic preview only. Never loads a production .env and never starts a worker.
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)),
  local = join(root, "artifacts/health-screen-20261107"),
  file = join(local, "preview-private.json");
const require = createRequire(join(root, "apps/api/package.json")),
  { PrismaClient } = require("@prisma/client"),
  { hash } = require("bcryptjs");
const { Client } = createRequire(join(root, "apps/migrator/package.json"))(
  "pg",
);
const database =
  "postgresql://health_preview@127.0.0.1:55447/saydian_health_screen_preview";
const action = process.argv[2];
if (!["prepare", "api", "admin", "vip", "arrival"].includes(action))
  throw Error("Use prepare/api/admin/vip/arrival");
const run = (cmd, args, env) =>
  new Promise((done, reject) => {
    const p = spawn(cmd, args, {
      cwd: root,
      env: { PATH: process.env.PATH, ...env },
      stdio: "inherit",
    });
    p.once("error", reject);
    p.once("exit", (code) =>
      code === 0 ? done() : reject(Error("Local command failed")),
    );
  });
if (action === "prepare") {
  await mkdir(local, { recursive: true });
  if (existsSync(file)) {
    console.log("Existing isolated preview retained.");
    process.exit(0);
  }
  const control = new Client({
    connectionString: "postgresql://health_preview@127.0.0.1:55447/postgres",
  });
  await control.connect();
  const exists = await control.query(
    "SELECT datname FROM pg_database WHERE datname='saydian_health_screen_preview'",
  );
  if (!exists.rows.length)
    await control.query("CREATE DATABASE saydian_health_screen_preview");
  await control.end();
  const env = {
    NODE_ENV: "development",
    DATABASE_URL: database,
    HOST: "127.0.0.1",
    PORT: "18097",
    PUBLIC_BASE_URL: "http://127.0.0.1:3310",
    CORS_ORIGINS: "http://127.0.0.1:3310,http://127.0.0.1:3311",
    ACCESS_TOKEN_SECRET: randomBytes(48).toString("base64url"),
    REFRESH_TOKEN_PEPPER: randomBytes(48).toString("base64url"),
    INTEGRATION_MASTER_KEY: randomBytes(32).toString("hex"),
    ALLOW_TEST_OTP: "false",
    SMS_PROVIDER: "disabled",
    AI_PROVIDER: "disabled",
    DEPLOYMENT_SITE: "cn",
    H5_DEMO_ENABLED: "true",
    MAINTENANCE_READ_ONLY: "false",
    BUSINESS_WRITES_PAUSED: "false",
    WORKER_OUTBOUND_PAUSED: "true",
    HEALTH_REPORT_WORKER_ENABLED: "false",
    CALLBACK_PROCESSING_PAUSED: "true",
    DOTENV_CONFIG_PATH: "/dev/null",
    DOTENV_CONFIG_QUIET: "true",
    TS_NODE_PROJECT: join(root, "apps/api/tsconfig.json"),
    VITE_API_PROXY_TARGET: "http://127.0.0.1:18097",
  };
  await run("pnpm", ["db:deploy"], env);
  const db = new PrismaClient({ datasources: { db: { url: database } } });
  if ((await db.user.count()) || (await db.adminUser.count()))
    throw Error("Non-empty preview retained; refusing seed");
  const password = "HealthPreview-" + randomBytes(6).toString("hex"),
    passwordHash = await hash(password, 12);
  const admin = await db.adminUser.create({
    data: {
      username: "health-preview-admin",
      displayName: "本地大屏验收管理员",
      passwordHash,
      role: "SUPER_ADMIN",
      roles: ["SUPER_ADMIN"],
    },
  });
  const level = await db.partnerLevel.upsert({
    where: { code: "distribution-1" },
    create: { code: "distribution-1", name: "战略伙伴（本地合成）" },
    update: {},
  });
  const partner = await db.brandPartner.create({
    data: {
      partnerNo: "HEALTH-PREVIEW",
      username: "health-preview-partner",
      name: "本地健康服务伙伴",
      passwordHash,
      promotionCode: "HEALTHPREVIEW",
      levelId: level.id,
    },
  });
  const member = await db.user.create({
    data: {
      nickname: "本地合成会员",
      gender: "MALE",
      birthday: new Date("1970-06-15"),
      locale: "zh-Hans",
      partnerId: partner.id,
      healthProfile: { create: { timezone: "Asia/Shanghai" } },
    },
  });
  const empty = await db.user.create({
    data: { nickname: "本地无数据会员", partnerId: partner.id },
  });
  const now = new Date(),
    records = [];
  for (let d = 0; d < 94; d++) {
    const observedAt = new Date(now.valueOf() - d * 86400000),
      day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(observedAt);
    const common = {
      userId: member.id,
      observedAt,
      timezoneOffsetMinutes: 480,
      sourcePlatform: "synthetic-local-preview",
      sourceDeviceKey: "synthetic-preview-device",
      sourceOrigin: "watch_history",
      sourceModel: "本地合成设备",
      sourceMetadata: { timeBasis: "sdk" },
      quality: d % 5 === 0 ? "UNKNOWN" : "VALID",
    };
    for (const [metric, values, unit, meta] of [
      ["HEART_RATE", { bpm: 68 + (d % 9) }, "bpm", {}],
      [
        "BLOOD_PRESSURE",
        { systolic: 112 + (d % 13), diastolic: 72 + (d % 8) },
        "mmHg",
        {},
      ],
      ["BLOOD_OXYGEN", { percent: 96 + (d % 4) }, "%", {}],
      ["HRV", { ms: 38 + (d % 22) }, "ms", { algorithm: "rmssd" }],
      [
        "TEMPERATURE",
        { celsius: 33 + (d % 6) / 10 },
        "°C",
        { temperatureKind: "skin" },
      ],
      ["BLOOD_GLUCOSE", { mmolL: 5.2 + (d % 4) / 10 }, "mmol/L", {}],
    ])
      records.push({
        ...common,
        clientRecordId: randomUUID(),
        metric,
        values,
        unit,
        sourceMetadata: { ...common.sourceMetadata, ...meta },
      });
    for (const [metric, values, unit] of [
      ["STEPS", { steps: 4000 + (d % 12) * 330 }, "steps"],
      ["SLEEP", { durationMinutes: 360 + (d % 10) * 11 }, "min"],
    ])
      records.push({
        ...common,
        clientRecordId: randomUUID(),
        metric,
        values,
        unit,
        aggregationKind: "daily_summary",
        aggregationActive: true,
        aggregationLocalDate: day,
      });
  }
  await db.healthRecord.createMany({ data: records });
  await db.appSetting.create({
    data: {
      key: "member_health_screen",
      value: { enabled: true },
      public: false,
    },
  });
  await writeFile(
    file,
    JSON.stringify(
      {
        env,
        admin: { username: admin.username, password },
        partner: { username: partner.username, password },
        memberId: member.id,
        emptyMemberId: empty.id,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await db.$disconnect();
  console.log(
    "Prepared isolated synthetic preview; private login file: artifacts/health-screen-20261107/preview-private.json",
  );
  process.exit(0);
}
const saved = JSON.parse(await readFile(file, "utf8"));
if (action === "arrival") {
  const db = new PrismaClient({ datasources: { db: { url: database } } });
  try {
    const member = await db.user.findUniqueOrThrow({
      where: { id: saved.memberId },
    });
    if (member.nickname !== "本地合成会员")
      throw Error(
        "Only the named synthetic preview member may receive fixture measurements",
      );
    const now = new Date();
    await db.healthRecord.createMany({
      data: [
        { metric: "HEART_RATE", unit: "bpm", values: { bpm: 73 } },
        { metric: "BLOOD_OXYGEN", unit: "%", values: { percent: 98 } },
      ].map((r) => ({
        ...r,
        userId: member.id,
        clientRecordId: randomUUID(),
        observedAt: now,
        timezoneOffsetMinutes: 480,
        sourcePlatform: "synthetic-local-preview",
        sourceDeviceKey: "synthetic-preview-device",
        sourceOrigin: "watch_history",
        sourceModel: "本地合成设备",
        sourceMetadata: { timeBasis: "sdk" },
        quality: "VALID",
      })),
    });
    console.log(
      "Appended 2 synthetic local measurement fixtures; no device or production server used.",
    );
  } finally {
    await db.$disconnect();
  }
}

if (action === "api")
  await run(
    process.execPath,
    [
      "-r",
      join(root, "apps/api/node_modules/ts-node/register/transpile-only"),
      join(root, "apps/api/src/main.ts"),
    ],
    saved.env,
  );
if (action === "admin")
  await run(
    "pnpm",
    [
      "--filter",
      "@saydian/app-admin-web",
      "exec",
      "vite",
      "--force",
      "--host",
      "127.0.0.1",
      "--port",
      "3310",
      "--strictPort",
    ],
    saved.env,
  );
if (action === "vip")
  await run(
    "pnpm",
    [
      "--filter",
      "@saydian/app-vip-web",
      "exec",
      "vite",
      "--force",
      "--host",
      "127.0.0.1",
      "--port",
      "3311",
      "--strictPort",
    ],
    saved.env,
  );
