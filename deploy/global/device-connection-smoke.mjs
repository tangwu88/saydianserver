// Explicit production QA for device list fields and connection history. Creates
// and removes one exact synthetic member/admin; never reads another row's detail.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";

assert(process.argv.includes("--synthetic-device"), "Explicit synthetic opt-in is required");
assert(process.env.APP_REALM === "global", "Run only in the international API container");
assert(new URL(process.env.DATABASE_URL).pathname === "/saydian_global", "Unexpected database");
setDefaultResultOrder("ipv4first");
const require = createRequire("/workspace/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const { sign } = require("jsonwebtoken");
const prisma = new PrismaClient();
const appRoot = "https://app.saydian.cn/global/api/saydian-app/v2";
const adminRoot = "https://app.saydian.cn/global/api/saydian-app/admin/v1";
const marker = `qa.device.${Date.now()}.${randomBytes(4).toString("hex")}`;
const email = `${marker}@example.invalid`;
const userSessionId = randomUUID();
const accessJti = randomUUID();
const adminToken = randomBytes(32).toString("hex");
let user;
let admin;
let checks = 0;
const evidence = { requests: [], syntheticRemoved: false };
function check(value, message) { assert(value, message); checks++; }
async function request(root, path, { token, body, expected = body ? 201 : 200 } = {}) {
  const response = await fetch(root + path, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  check(response.status === expected, `${path}: expected HTTP ${expected}, got ${response.status}`);
  evidence.requests.push({ path, status: response.status, requestId: result.requestId });
  return result.data;
}

try {
  user = await prisma.user.create({ data: {
    email,
    emailVerifiedAt: new Date(),
    nickname: "Synthetic device QA",
    locale: "en",
    sessions: { create: {
      id: userSessionId,
      accessJti,
      refreshTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      expiresAt: new Date(Date.now() + 300_000),
    } },
  } });
  admin = await prisma.adminUser.create({ data: {
    username: marker,
    displayName: "Synthetic device QA",
    passwordHash: "synthetic-session-only",
    role: "SUPER_ADMIN",
    roles: ["SUPER_ADMIN"],
    sessions: { create: {
      tokenHash: createHash("sha256").update(adminToken).digest("hex"),
      expiresAt: new Date(Date.now() + 300_000),
    } },
  } });
  const userToken = sign(
    { sub: user.id, sid: userSessionId, typ: "access" },
    process.env.ACCESS_TOKEN_SECRET,
    {
      algorithm: "HS256",
      expiresIn: 300,
      jwtid: accessJti,
      issuer: "saydian-global-server",
      audience: "saydian-global-app",
    },
  );
  await request(appRoot, "/devices", { token: userToken, body: {
    deviceId: marker,
    vendor: "Synthetic QA",
    model: "QA-DEVICE-1",
    displayName: "QA Bluetooth Device",
    macAddress: "AA-BB-CC-DD-EE-01",
    firmware: "1.0.0",
  } });
  await request(appRoot, "/devices", { token: userToken, body: {
    deviceId: marker,
    vendor: "Synthetic QA",
    model: "QA-DEVICE-1",
    displayName: "QA Bluetooth Device",
    firmware: "1.0.1",
  } });

  const rows = await request(adminRoot, "/devices", { token: adminToken });
  const row = rows.find((item) => item.memberNo === String(user.compatibilityId));
  check(row?.memberNickname === "Synthetic device QA", "Admin list must show the member nickname");
  check(row?.bluetoothName === "QA Bluetooth Device" && row.model === "QA-DEVICE-1",
    "Admin list must show Bluetooth name and model");
  check(row?.macAddress === "AA:BB:CC:DD:EE:01", "A later report without MAC must preserve the stored address");

  const detail = await request(adminRoot, `/devices/${row.id}/connections`, { token: adminToken });
  check(detail.device.memberNo === String(user.compatibilityId), "Detail must belong to the exact synthetic member");
  check(detail.connections.length === 2, "Both successful connections must be recorded");
  check(detail.connections[0].firmware === "1.0.1" && detail.connections[1].firmware === "1.0.0",
    "Connection snapshots must be newest first");
  check(detail.connections[0].macAddress === null && detail.connections[1].macAddress === "AA:BB:CC:DD:EE:01",
    "Connection history must preserve what each report actually supplied");
} finally {
  if (admin) await prisma.adminUser.deleteMany({ where: { id: admin.id, username: marker } });
  if (user) await prisma.user.deleteMany({ where: { id: user.id, email } });
  evidence.syntheticRemoved = await prisma.adminUser.count({ where: { username: marker } }) === 0
    && await prisma.user.count({ where: { email } }) === 0;
  await prisma.$disconnect();
  check(evidence.syntheticRemoved, "The exact synthetic member/admin must be removed");
  console.log(JSON.stringify({ ...evidence, checks }));
}
