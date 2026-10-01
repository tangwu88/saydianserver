// Explicit production QA for versioned daily summaries. Creates and removes
// one exact synthetic member; never reads an existing member's health data.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";

assert(process.argv.includes("--synthetic-daily-summary"), "Explicit synthetic opt-in is required");
assert(process.env.APP_REALM === "global", "Run only in the international API container");
assert(new URL(process.env.DATABASE_URL).pathname === "/saydian_global", "Unexpected database");
setDefaultResultOrder("ipv4first");
const require = createRequire("/workspace/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const { sign } = require("jsonwebtoken");
const prisma = new PrismaClient();
const root = "https://app.saydian.cn/global/api/saydian-app/v2";
const marker = `qa.daily-summary.${Date.now()}.${randomBytes(4).toString("hex")}`;
const email = `${marker}@example.invalid`;
const sessionId = randomUUID();
const accessJti = randomUUID();
const refreshTokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
const deviceId = `urion:${marker}`;
let user;
let checks = 0;
const evidence = { requests: [], syntheticRemoved: false };
function check(value, message) { assert(value, message); checks++; }
async function request(path, { token, body, key, expected = body ? 201 : 200 } = {}) {
  const response = await fetch(root + path, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  check(response.status === expected, `${path}: expected HTTP ${expected}, got ${response.status}`);
  evidence.requests.push({ path: path.split("?")[0], status: response.status, requestId: result.requestId });
  return result.data;
}
function daily(id, value, observedAt, localDate) {
  return {
    id,
    metric: "steps",
    observedAt,
    timezoneOffsetMinutes: 480,
    values: { value },
    unit: "steps",
    quality: "valid",
    aggregation: { kind: "daily_summary", localDate },
    source: {
      platform: "ios",
      deviceId,
      model: "SYNTHETIC-QA",
      origin: "watch_history",
      measurementSource: "wearable",
      rawVersion: 1,
    },
  };
}

try {
  await request("/health/capabilities", { expected: 401 });
  user = await prisma.user.create({ data: {
    email,
    emailVerifiedAt: new Date(),
    nickname: "Synthetic daily summary QA",
    locale: "en",
    sessions: { create: {
      id: sessionId,
      accessJti,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 300_000),
    } },
  } });
  const token = sign(
    { sub: user.id, sid: sessionId, typ: "access" },
    process.env.ACCESS_TOKEN_SECRET,
    {
      algorithm: "HS256",
      expiresIn: 300,
      jwtid: accessJti,
      issuer: "saydian-global-server",
      audience: "saydian-global-app",
    },
  );
  const capabilities = await request("/health/capabilities", { token });
  check(capabilities.dailySummaryVersions === true && capabilities.dailySummaryVersion === 1,
    "Daily summary capability is missing or has the wrong version");

  const now = Date.now();
  const localDate = new Date(now + 8 * 60 * 60_000).toISOString().slice(0, 10);
  const first = daily(`${marker}.v1`, 1000, new Date(now - 120_000).toISOString(), localDate);
  const second = daily(`${marker}.v2`, 1200, new Date(now - 60_000).toISOString(), localDate);
  const firstResult = await request("/health/records/batch", {
    token,
    key: `${marker}.first`,
    body: { records: [first] },
  });
  const secondResult = await request("/health/records/batch", {
    token,
    key: `${marker}.second`,
    body: { records: [second] },
  });
  check(firstResult.acceptedIds.includes(first.id) && secondResult.acceptedIds.includes(second.id),
    "Both daily summary versions must be accepted");

  const page = await request("/health/records?metric=steps&limit=10", { token });
  const summaries = page.items.filter((item) => item.aggregation?.kind === "daily_summary" && item.aggregation.localDate === localDate);
  check(summaries.length === 1 && summaries[0].id === second.id && summaries[0].values.value === 1200,
    "Only the newest daily summary may be visible");
  const stored = await prisma.healthRecord.findMany({
    where: { userId: user.id, aggregationKind: "daily_summary", aggregationLocalDate: localDate },
    select: { clientRecordId: true, aggregationActive: true },
  });
  check(stored.length === 2 && stored.filter((row) => row.aggregationActive).length === 1,
    "Both versions must be retained with exactly one active row");
} finally {
  if (user) await prisma.user.deleteMany({ where: { id: user.id, email } });
  evidence.syntheticRemoved = await prisma.user.count({ where: { email } }) === 0;
  await prisma.$disconnect();
  check(evidence.syntheticRemoved, "The exact synthetic member must be removed");
  console.log(JSON.stringify({ ...evidence, checks }));
}
