// Actual production IMAGE in hosted CI, exact owned synthetic users only.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
const base = new URL(process.argv[2] ?? "");
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert(
  process.env.GITHUB_ACTIONS === "true" &&
    process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.NODE_ENV === "test",
);
assert(
  base.origin === "http://127.0.0.1:18080" &&
    ["127.0.0.1", "localhost"].includes(dbUrl.hostname) &&
    /test/.test(dbUrl.pathname),
);
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { PrismaClient } = require("@prisma/client"),
  bcrypt = require("bcryptjs"),
  db = new PrismaClient();
const marker = "CI_CARE_IMAGE_" + randomUUID(),
  users = [],
  keys = [];
const digest = (value) => createHash("sha256").update(value).digest("hex");
async function request(path, token, method = "GET", body) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "error",
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, json: await response.json() };
}
const v2 = "/api/saydian-app/v2",
  v1 = "/api/v1/member";
try {
  for (let index = 0; index < 2; index++) {
    const mobile =
      "199" +
      String(
        BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 12)) %
          100000000n,
      ).padStart(8, "0");
    users.push(
      await db.user.create({
        data: {
          nickname: marker,
          mobile: "+86" + mobile,
          mobileVerifiedAt: new Date(),
          passwordHash: await bcrypt.hash("synthetic-image-password", 12),
        },
      }),
    );
  }
  const tokens = [];
  for (const user of users) {
    const login = await request(v2 + "/auth/login", null, "POST", {
      mobile: user.mobile,
      password: "synthetic-image-password",
    });
    assert.equal(login.json.code, 200);
    tokens.push(login.json.data.accessToken);
  }
  keys.push(
    "care-invite:account:" + digest(users[0].id),
    "care-invite:target:" + digest("memberNo:" + users[1].compatibilityId),
  );
  for (const prefix of ["", "/global"]) {
    await db.globalVerificationThrottle.updateMany({
      where: { key: { in: keys } },
      data: { reservedAt: new Date(0) },
    });
    const ack = await request(
      prefix + v2 + "/care/invitations",
      tokens[0],
      "POST",
      { memberNo: String(users[1].compatibilityId) },
    );
    assert.equal(ack.status, 202);
    assert.equal(ack.json.code, 200);
    assert.deepEqual(ack.json.data, { invitationSubmitted: true });
    const received = (
      await request(prefix + v2 + "/care/relationships", tokens[1])
    ).json.data;
    assert.equal(received.length, 1);
    const id = received[0].id,
      path = prefix + v2 + "/care/relationships/" + id;
    const legacy = (await request(prefix + v1 + "/care", tokens[1])).json.data;
    assert.equal(legacy.length, 1);
    const number = legacy[0].id;
    for (const row of [
      legacy[0].member,
      legacy[0].inviter,
      legacy[0].to_member,
    ])
      for (const key of ["mobile", "email", "birthday", "height", "weight"])
        assert(!Object.hasOwn(row, key));
    assert.deepEqual(
      (await request(prefix + v2 + "/care/relationships", tokens[0])).json.data,
      [],
    );
    assert.deepEqual(
      (await request(prefix + v1 + "/care", tokens[0])).json.data,
      [],
    );
    assert.equal(
      (await request(prefix + v1 + "/care/preview?id=" + number, tokens[0]))
        .json.code,
      404,
    );
    assert.equal((await request(path, tokens[0], "DELETE")).status, 404);
    for (const memberNo of [String(users[1].compatibilityId), "2147483647"])
      assert.equal(
        (
          await request(prefix + v2 + "/care/invitations", tokens[0], "POST", {
            memberNo,
          })
        ).status,
        429,
      );
    assert.equal(
      (
        await request(prefix + v1 + "/care/save", tokens[1], "POST", {
          id: number,
          examine_status: 1,
        })
      ).json.code,
      200,
    );
    assert.equal(
      (await request(prefix + v2 + "/care/relationships", tokens[0])).json.data
        .length,
      1,
    );
    assert.equal(
      (await request(path + "/health?metric=heart_rate", tokens[0])).status,
      403,
    );
    assert.equal(
      (
        await request(path + "/permissions", tokens[1], "POST", {
          metrics: ["heart_rate"],
        })
      ).json.code,
      200,
    );
    assert.equal(
      (await request(path + "/health?metric=heart_rate", tokens[0])).status,
      200,
    );
    assert.equal(
      (await request(path + "/health?metric=blood_oxygen", tokens[0])).status,
      403,
    );
    assert(
      !Object.hasOwn(
        (await request(prefix + v1 + "/care", tokens[0])).json.data[0].member,
        "mobile",
      ),
    );
    assert.equal((await request(path, tokens[1], "DELETE")).json.code, 200);
  }
  // The explicit contact path still returns its original relation/profile.
  const contact = await request(v2 + "/care/invitations", tokens[0], "POST", {
    mobile: users[1].mobile,
  });
  assert.equal(contact.json.code, 200);
  assert.equal(contact.json.data.status, "pending");
  assert.equal(
    (await request(v1 + "/care", tokens[0])).json.data[0].member.mobile,
    users[1].mobile,
  );
  console.log(
    "Care privacy actual-image HTTP V1/V2/global, disclosure/permissions and old-contact compatibility passed.",
  );
} finally {
  for (const user of users) {
    const current = await db.user.findUnique({
      where: { id: user.id },
      select: { nickname: true },
    });
    assert(
      !current || current.nickname === marker,
      "Fixture ownership changed",
    );
  }
  const relations = await db.careRelationship.findMany({
    where: {
      inviterId: { in: users.map((u) => u.id) },
      recipientId: { in: users.map((u) => u.id) },
    },
    select: { id: true },
  });
  await db.outboxEvent.deleteMany({
    where: {
      aggregateType: "care_relationship",
      aggregateId: { in: relations.map((r) => r.id) },
    },
  });
  await db.globalVerificationThrottle.deleteMany({
    where: { key: { in: keys } },
  });
  await db.user.deleteMany({
    where: { id: { in: users.map((u) => u.id) }, nickname: marker },
  });
  await db.$disconnect();
}
