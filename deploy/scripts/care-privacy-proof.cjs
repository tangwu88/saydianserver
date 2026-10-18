// Run by an external read-only deployment probe INSIDE the immutable image.
// No database/network, credentials, environment compatibility flag or label.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) =>
    key === "OR"
      ? value.some((part) => matches(row, part))
      : key === "AND"
        ? value.every((part) => matches(row, part))
        : value && typeof value === "object" && "not" in value
          ? row[key] !== value.not
          : row[key] === value,
  );
}
function fixture({
  CareService,
  CareController,
  LegacyService,
  LegacyMemberController,
}) {
  const users = [27, 28, 29].map((compatibilityId, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    compatibilityId,
    legacyMemberId: null,
    status: "ACTIVE",
    nickname: "Synthetic privacy probe",
    email: `fixture${compatibilityId}@example.invalid`,
    mobile: `+86138000000${compatibilityId}`,
    avatarUrl: null,
    gender: "UNSPECIFIED",
    birthday: new Date("2000-01-01Z"),
    heightCm: null,
    weightKg: null,
  }));
  const rows = [],
    permissions = [],
    reservations = new Map();
  const expand = (row) =>
    row && {
      ...row,
      permissions: permissions.filter((p) => p.relationshipId === row.id),
      inviter: users.find((u) => u.id === row.inviterId),
      recipient: users.find((u) => u.id === row.recipientId),
    };
  const db = {
    $executeRaw: async () => 1,
    $queryRaw: async (_sql, id) =>
      users.filter((u) => u.id === id).map(({ status }) => ({ status })),
    user: {
      findUnique: async ({ where }) =>
        users.find((u) => matches(u, where)) ?? null,
      findFirst: async ({ where }) =>
        users.find((u) => matches(u, where)) ?? null,
    },
    careRelationship: {
      findUnique: async ({ where }) =>
        expand(
          rows.find((r) =>
            where.inviterId_recipientId
              ? matches(r, where.inviterId_recipientId)
              : matches(r, where),
          ),
        ) ?? null,
      findFirst: async ({ where }) =>
        expand(rows.find((r) => matches(r, where))) ?? null,
      findUniqueOrThrow: async ({ where }) => {
        const r = expand(rows.find((r) => matches(r, where)));
        assert(r);
        return r;
      },
      findMany: async ({ where }) =>
        rows.filter((r) => matches(r, where)).map(expand),
      upsert: async ({ where, create, update }) => {
        let row = rows.find((r) => matches(r, where.inviterId_recipientId));
        if (row) Object.assign(row, update);
        else {
          row = {
            id: "10000000-0000-4000-8000-000000000001",
            compatibilityId: 1,
            identityDisclosure: "CONTACT",
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: null,
            ...create,
          };
          rows.push(row);
        }
        return row;
      },
      update: async ({ where, data }) => {
        const row = rows.find((r) => matches(r, where));
        assert(row);
        Object.assign(row, data);
        return row;
      },
    },
    globalVerificationThrottle: {
      upsert: async ({ create }) => {
        if (!reservations.has(create.key))
          reservations.set(create.key, create.reservedAt);
      },
      updateMany: async ({ where, data }) => {
        if (reservations.get(where.key) > where.reservedAt.lte)
          return { count: 0 };
        reservations.set(where.key, data.reservedAt);
        return { count: 1 };
      },
    },
    carePermission: {
      deleteMany: async ({ where }) => {
        for (let i = permissions.length - 1; i >= 0; i--)
          if (matches(permissions[i], where)) permissions.splice(i, 1);
      },
      createMany: async ({ data }) =>
        permissions.push(
          ...data.map((p) => ({ enabled: true, expiresAt: null, ...p })),
        ),
    },
    careAccessAudit: { create: async () => ({}) },
    notification: { upsert: async () => ({ id: "synthetic" }) },
    outboxEvent: { upsert: async () => ({}) },
    legacyIdMap: { findUnique: async () => null, findMany: async () => [] },
  };
  db.$transaction = (work) => work(db);
  const care = new CareService(db),
    legacy = new LegacyService(db),
    v2 = new CareController(care, {});
  const v1 = new LegacyMemberController(
    {},
    {},
    {
      legacyRecords: async () => {
        throw new Error("Unexpected unguarded health read");
      },
    },
    care,
    {},
    {},
    legacy,
  );
  return { users, rows, permissions, reservations, care, legacy, v2, v1 };
}

async function assertApiPrivacy(classes) {
  const h = fixture(classes),
    [sender, recipient, other] = h.users;
  const user = (u) => ({ id: u.id, sessionId: "synthetic" }),
    code = {
      value: null,
      status(value) {
        this.value = value;
      },
    };
  assert.deepEqual(await h.v2.invite(user(sender), { memberNo: "28" }, code), {
    invitationSubmitted: true,
  });
  assert.equal(code.value, 202);
  assert.equal(h.rows[0].identityDisclosure, "MEMBER_NO_PENDING");
  const id = h.rows[0].id;
  assert.deepEqual(await h.v2.relationships(user(sender)), []);
  assert.equal((await h.v2.relationships(user(recipient))).length, 1);
  assert.deepEqual((await h.v1.careInvitations(user(sender))).data, []);
  const incoming = (await h.v1.careInvitations(user(recipient))).data;
  assert.equal(incoming.length, 1);
  for (const member of [
    incoming[0].member,
    incoming[0].inviter,
    incoming[0].to_member,
  ])
    for (const key of ["mobile", "email", "birthday", "height", "weight"])
      assert(
        !Object.hasOwn(member, key),
        "Private V1 member projection leaked",
      );
  for (const actor of [sender, other]) {
    await assert.rejects(
      h.v1.carePreview(user(actor), { id: "1" }, { requestId: "synthetic" }),
      { status: 404 },
    );
    await assert.rejects(
      h.v1.respondCare(user(actor), { id: "1", examine_status: 1 }),
      { status: 404 },
    );
    await assert.rejects(h.v2.revoke(user(actor), id), { status: 404 });
  }
  for (const memberNo of ["28", "2147483647"])
    await assert.rejects(h.v2.invite(user(sender), { memberNo }, code), {
      status: 429,
    });
  await h.v1.respondCare(user(recipient), { id: "1", examine_status: 1 });
  assert.equal(h.rows[0].identityDisclosure, "MEMBER_NO_ACCEPTED");
  assert.equal((await h.v2.relationships(user(sender))).length, 1);
  const accepted = (await h.v1.careMembers(user(sender))).data;
  assert.equal(accepted.length, 1);
  assert(!Object.hasOwn(accepted[0].member, "mobile"));
  await assert.rejects(h.care.authorizedSubject(sender.id, id, "HEART_RATE"), {
    status: 403,
  });
  await h.v2.savePermissions(user(recipient), id, { metrics: ["heart_rate"] });
  assert.equal(
    await h.care.authorizedSubject(sender.id, id, "HEART_RATE"),
    recipient.id,
  );
  await assert.rejects(
    h.care.authorizedSubject(sender.id, id, "BLOOD_OXYGEN"),
    { status: 403 },
  );
  await h.v2.revoke(user(recipient), id);
  await assert.rejects(h.care.authorizedSubject(sender.id, id, "HEART_RATE"), {
    status: 403,
  });
  // Expire only these in-memory test reservations. No production bypass exists.
  for (const key of h.reservations.keys()) h.reservations.set(key, new Date(0));
  await h.v2.invite(user(sender), { memberNo: "28" }, code);
  await h.v2.respond(user(recipient), id, { accepted: false });
  assert.deepEqual(await h.v2.relationships(user(sender)), []);
  assert.deepEqual((await h.v1.careInvitations(user(sender))).data, []);
  const contact = fixture(classes);
  const relation = await contact.care.invite(
    contact.users[0].id,
    contact.users[1].email,
  );
  assert.equal(relation.status, "pending");
  assert.equal(
    (await contact.v1.careInvitations(user(contact.users[0]))).data[0].member
      .mobile,
    contact.users[1].mobile,
  );
}

function assertPrivacyDataModel(Prisma) {
  const field = Prisma.dmmf.datamodel.models
    .find((m) => m.name === "CareRelationship")
    ?.fields.find((f) => f.name === "identityDisclosure");
  assert(
    field?.type === "CareIdentityDisclosure" && field.isRequired,
    "Generated database client predates privacy disclosure",
  );
  assert.deepEqual(
    Prisma.dmmf.datamodel.enums
      .find((e) => e.name === "CareIdentityDisclosure")
      ?.values.map((v) => v.name),
    ["CONTACT", "MEMBER_NO_PENDING", "MEMBER_NO_ACCEPTED"],
  );
}
async function verifyRuntime(directory, role) {
  assert(["api", "worker"].includes(role));
  const requireRuntime = createRequire(resolve(directory, "package.json"));
  const { Prisma } = requireRuntime("@prisma/client");
  assertPrivacyDataModel(Prisma);
  if (role === "api")
    await assertApiPrivacy({
      CareService: requireRuntime("./dist/care/care.service.js").CareService,
      CareController: requireRuntime("./dist/care/care.controller.js")
        .CareController,
      LegacyService: requireRuntime("./dist/legacy/legacy.service.js")
        .LegacyService,
      LegacyMemberController: requireRuntime(
        "./dist/legacy/legacy-member.controller.js",
      ).LegacyMemberController,
    });
}
module.exports = { verifyRuntime, assertApiPrivacy, assertPrivacyDataModel };
if (require.main === module)
  verifyRuntime(process.cwd(), process.argv[2])
    .then(() => console.log("care-privacy-proof:" + process.argv[2]))
    .catch(() => {
      console.error("Care privacy runtime behavior cannot be proven.");
      process.exitCode = 1;
    });
