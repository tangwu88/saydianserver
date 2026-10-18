import { afterEach, describe, expect, it, vi } from "vitest";
import { careInvitationTarget } from "./care-invitation";
import { CareService } from "./care.service";
import { CareController } from "./care.controller";
import { LegacyService } from "../legacy/legacy.service";

const now = new Date("2026-10-18T08:00:00Z");
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) =>
    key === "OR"
      ? value.some((part: any) => matches(row, part))
      : key === "AND"
        ? value.every((part: any) => matches(row, part))
        : value && typeof value === "object" && "not" in value
          ? row[key] !== value.not
          : row[key] === value,
  );
}
function harness() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const users = [
    {
      id: "viewer",
      compatibilityId: 27,
      email: "a@example.invalid",
      mobile: "+8613800000027",
      status: "ACTIVE",
    },
    {
      id: "subject",
      compatibilityId: 28,
      email: "b@example.invalid",
      mobile: "+8613800000028",
      status: "ACTIVE",
    },
    {
      id: "other",
      compatibilityId: 29,
      email: "c@example.invalid",
      mobile: "+8613800000029",
      status: "ACTIVE",
    },
  ].map((user) => ({
    legacyMemberId: null,
    nickname: "Synthetic",
    avatarUrl: null,
    gender: "UNSPECIFIED",
    birthday: null,
    heightCm: null,
    weightKg: null,
    ...user,
  }));
  const relationships: any[] = [],
    reservations = new Map<string, Date>();
  const tx: any = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (_sql: unknown, id: string) =>
      users.filter((user) => user.id === id).map(({ status }) => ({ status })),
    ),
    user: {
      findFirst: vi.fn(
        async ({ where }: any) =>
          users.find((row) => matches(row, where)) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: any) =>
          users.find((row) =>
            Object.entries(where).every(
              ([key, value]) => (row as any)[key] === value,
            ),
          ) ?? null,
      ),
    },
    globalVerificationThrottle: {
      upsert: vi.fn(async ({ create }: any) => {
        if (!reservations.has(create.key))
          reservations.set(create.key, create.reservedAt);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (
          (reservations.get(where.key)?.valueOf() ?? Infinity) >
          where.reservedAt.lte.valueOf()
        )
          return { count: 0 };
        reservations.set(where.key, data.reservedAt);
        return { count: 1 };
      }),
    },
    careRelationship: {
      findUnique: vi.fn(
        async ({ where }: any) =>
          relationships.find((row) =>
            where.id
              ? row.id === where.id
              : where.compatibilityId
                ? row.compatibilityId === where.compatibilityId
                : row.inviterId === where.inviterId_recipientId.inviterId &&
                  row.recipientId === where.inviterId_recipientId.recipientId,
          ) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: any) =>
          relationships.find((row) => matches(row, where)) ?? null,
      ),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let row = relationships.find(
          (item) =>
            item.inviterId === where.inviterId_recipientId.inviterId &&
            item.recipientId === where.inviterId_recipientId.recipientId,
        );
        if (row) Object.assign(row, update);
        else {
          row = {
            id: `relation-${relationships.length}`,
            compatibilityId: relationships.length + 1,
            identityDisclosure: "CONTACT",
            expiresAt: null,
            createdAt: now,
            updatedAt: now,
            ...create,
          };
          relationships.push(row);
        }
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) =>
        Object.assign(
          relationships.find((row) => row.id === where.id),
          data,
        ),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => ({
        ...relationships.find((row) => row.id === where.id),
        permissions: [],
      })),
      findMany: vi.fn(async ({ where }: any) =>
        relationships
          .filter((row) => matches(row, where))
          .map((row) => ({
            ...row,
            permissions: [],
            inviter: users.find((u) => u.id === row.inviterId),
            recipient: users.find((u) => u.id === row.recipientId),
          })),
      ),
    },
    carePermission: {
      deleteMany: vi.fn(async () => ({})),
      createMany: vi.fn(async () => ({})),
    },
    notification: { upsert: vi.fn(async () => ({ id: "notification" })) },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
    legacyIdMap: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  };
  let queue = Promise.resolve();
  const prisma: any = {
    ...tx,
    $transaction: (work: any) => {
      const result = queue.then(() => work(tx));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  return {
    users,
    relationships,
    reservations,
    tx,
    service: new CareService(prisma),
    legacy: new LegacyService(prisma),
  };
}
afterEach(() => vi.useRealTimers());

describe("explicit care invitation targets", () => {
  it.each(["1", "29", "2147483647"])(
    "accepts the canonical member number %s",
    (memberNo) => {
      expect(careInvitationTarget({ memberNo })).toEqual({
        memberNo: Number(memberNo),
        key: `memberNo:${memberNo}`,
      });
    },
  );
  it.each([
    0,
    29,
    null,
    "",
    "0",
    "-1",
    "01",
    "+29",
    " 29",
    "29 ",
    "1.0",
    "1e2",
    "2147483648",
    "9999999999999999",
    "viewer",
    "２９",
  ])("rejects malformed member numbers %s", (memberNo) => {
    expect(() => careInvitationTarget({ memberNo })).toThrow();
  });
  it.each([
    { memberNo: "29", identifier: "a@example.invalid" },
    { memberNo: "29", mobile: "" },
  ])("rejects mixed target modes", (input) => {
    expect(() => careInvitationTarget(input)).toThrow();
  });
  it("keeps contact normalization and the legacy string caller", () => {
    expect(
      careInvitationTarget({ identifier: " B@Example.Invalid " }),
    ).toHaveProperty("email", "b@example.invalid");
    expect(careInvitationTarget("13800000028")).toHaveProperty(
      "mobile",
      "+8613800000028",
    );
  });
});

describe("private numbered invitations and concurrency", () => {
  it("uses compatibilityId only and acknowledges without leaking a UUID or profile", async () => {
    const h = harness();
    expect(await h.service.invite("viewer", { memberNo: "28" })).toEqual({
      invitationSubmitted: true,
    });
    expect(h.tx.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { compatibilityId: 28 } }),
    );
    expect(h.relationships[0]).toMatchObject({
      inviterId: "viewer",
      recipientId: "subject",
      status: "PENDING",
    });
    expect(h.tx.notification.upsert).toHaveBeenCalledOnce();
    expect(h.tx.carePermission.createMany).not.toHaveBeenCalled();
    expect(
      [...h.reservations.keys()].every((key) =>
        /^care-invite:(account|target):[a-f0-9]{64}$/.test(key),
      ),
    ).toBe(true);
  });
  it.each(["missing", "DISABLED", "DELETION_PENDING", "DELETED"])(
    "does not reveal or invite an unavailable %s target",
    async (status) => {
      const h = harness();
      if (status !== "missing") h.users[1]!.status = status;
      expect(
        await h.service.invite("viewer", {
          memberNo: status === "missing" ? "2147483647" : "28",
        }),
      ).toEqual({ invitationSubmitted: true });
      expect(h.tx.notification.upsert).not.toHaveBeenCalled();
      expect(h.relationships).toHaveLength(0);
      expect(
        [...h.reservations.values()].every(
          (time) => time.valueOf() === now.valueOf(),
        ),
      ).toBe(true);
    },
  );
  it("rejects self invitations and exposes HTTP202 only for the new mode", async () => {
    const h = harness();
    await expect(
      h.service.invite("viewer", { memberNo: "27" }),
    ).rejects.toMatchObject({ status: 400 });
    vi.setSystemTime(new Date(now.valueOf() + 60_001));
    const controller = new CareController(h.service, {} as any),
      response = { status: vi.fn() };
    await expect(
      controller.invite(
        { id: "viewer", sessionId: "session" },
        { memberNo: "28" },
        response as any,
      ),
    ).resolves.toEqual({ invitationSubmitted: true });
    expect(response.status).toHaveBeenCalledWith(202);
  });
  it("applies the same cooldown to repeated known and unknown numbered invitations", async () => {
    const h = harness();
    const responses = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        h.service.invite("viewer", { memberNo: "28" }),
      ),
    );
    expect(responses.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      responses
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason.status),
    ).toEqual([429, 429]);
    expect(h.relationships).toHaveLength(1);
    expect(h.tx.notification.upsert).toHaveBeenCalledOnce();
    expect(h.tx.$executeRaw).toHaveBeenCalled();
    await expect(
      h.service.invite("viewer", { memberNo: "2147483647" }),
    ).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date(now.valueOf() + 60_001));
    await expect(
      h.service.invite("viewer", { memberNo: "28" }),
    ).resolves.toEqual({ invitationSubmitted: true });
    expect(h.tx.notification.upsert).toHaveBeenCalledOnce();
  });
  it("retains account cooldown after a missing target and does not reveal a later target", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "2147483647" });
    await expect(
      h.service.invite("viewer", { memberNo: "28" }),
    ).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date(now.valueOf() + 30_001));
    await expect(
      h.service.invite("viewer", { memberNo: "28" }),
    ).resolves.toEqual({ invitationSubmitted: true });
  });
  it("limits different accounts targeting the same number, including unavailable numbers", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "2147483647" });
    await expect(
      h.service.invite("other", { memberNo: "2147483647" }),
    ).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date(now.valueOf() + 60_001));
    await expect(
      h.service.invite("other", { memberNo: "2147483647" }),
    ).resolves.toEqual({ invitationSubmitted: true });
  });
  it("preserves contact responses and pending idempotence; active repeats stay409 only for contacts", async () => {
    const h = harness(),
      first = await h.service.invite("viewer", "13800000028");
    expect(
      await h.service.invite("viewer", { identifier: "B@example.invalid" }),
    ).toMatchObject({ id: first.id });
    h.relationships[0].status = "ACTIVE";
    await expect(
      h.service.invite("viewer", "13800000028"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await h.service.invite("viewer", { memberNo: "28" })).toEqual({
      invitationSubmitted: true,
    });
    expect(h.reservations.size).toBe(2);
  });
  it("does not impose numbered account/target cooldowns on old contact invitations", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "28" });
    await expect(
      h.service.invite("other", { identifier: "b@example.invalid" }),
    ).resolves.toMatchObject({ status: "pending" });
    await expect(
      h.service.invite("viewer", "13800000029"),
    ).resolves.toMatchObject({ status: "pending" });
    expect(h.relationships).toHaveLength(3);
    expect(h.tx.notification.upsert).toHaveBeenCalledTimes(3);
    expect(h.reservations.size).toBe(2); // Only the first numbered request reserved.
  });
  it.each(["missing", "DISABLED", "DELETION_PENDING", "DELETED"])(
    "rejects unavailable contact %s without changing contact cadence",
    async (status) => {
      const h = harness();
      if (status !== "missing") h.users[1]!.status = status;
      await expect(
        h.service.invite(
          "viewer",
          status === "missing" ? "missing@example.invalid" : "13800000028",
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        h.service.invite("viewer", "13800000029"),
      ).resolves.toMatchObject({ status: "pending" });
      expect(h.tx.notification.upsert).toHaveBeenCalledOnce();
      expect(h.reservations.size).toBe(0);
    },
  );
  it("hides numbered pending identities in V2 and V1 until acceptance, without sharing contact or body data", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "28" });
    expect(await h.service.relationships("viewer")).toEqual([]);
    expect(await h.legacy.careRows("viewer", false)).toEqual([]);
    expect(await h.service.relationships("subject")).toHaveLength(1);
    const incoming = await h.legacy.careRows("subject", false);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.member).not.toHaveProperty("mobile");
    expect(incoming[0]?.to_member).not.toHaveProperty("birthday");
    await expect(
      h.legacy.relationshipByCompatibilityId(1, "viewer"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.revoke("viewer", "relation-0"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.legacy.relationshipByCompatibilityId(1, "other"),
    ).rejects.toMatchObject({ status: 404 });
    await h.service.respond("subject", "relation-0", true);
    const rows = await h.service.relationships("viewer");
    expect(rows[0]?.inviter).toMatchObject({ id: "viewer", memberNo: "27" });
    expect(rows[0]?.recipient).toMatchObject({ id: "subject", memberNo: "28" });
    expect(JSON.stringify(rows)).not.toMatch(/example.invalid|138000000/);
    expect(h.relationships[0].identityDisclosure).toBe("MEMBER_NO_ACCEPTED");
    expect(await h.legacy.careRows("viewer", false)).toHaveLength(1);
    await expect(
      h.legacy.relationshipByCompatibilityId(1, "viewer"),
    ).resolves.toHaveProperty("id", "relation-0");
    expect(h.tx.carePermission.createMany).not.toHaveBeenCalled();
  });
  it.each(["rejected", "revoked"])(
    "keeps an unaccepted numbered identity hidden after %s",
    async (status) => {
      const h = harness();
      await h.service.invite("viewer", { memberNo: "28" });
      if (status === "rejected")
        await h.service.respond("subject", "relation-0", false);
      else await h.service.revoke("subject", "relation-0");
      expect(await h.service.relationships("viewer")).toEqual([]);
      expect(await h.legacy.careRows("viewer", false)).toEqual([]);
    },
  );
  it("preserves contact pending visibility and can explicitly change a numbered pending invite to contact mode", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "28" });
    await h.service.invite("viewer", "b@example.invalid");
    expect(h.relationships[0].identityDisclosure).toBe("CONTACT");
    expect(await h.service.relationships("viewer")).toHaveLength(1);
    expect(
      (await h.legacy.careRows("viewer", false))[0]?.member,
    ).toHaveProperty("mobile", "+8613800000028");
    expect(h.tx.notification.upsert).toHaveBeenCalledOnce();
  });
  it("does not reveal account existence through different V1 health/settings errors", async () => {
    const h = harness();
    for (const memberNo of ["28", "2147483647"]) {
      await expect(
        h.legacy.viewerRelationship("viewer", memberNo),
      ).rejects.toMatchObject({
        status: 404,
        message: "未找到可查看的关爱关系",
      });
      await expect(
        h.legacy.relationshipForSettings("viewer", memberNo),
      ).rejects.toMatchObject({ status: 404, message: "未找到关爱关系" });
    }
  });
  it("never acknowledges storage failures as accepted requests", async () => {
    const h = harness();
    h.tx.notification.upsert.mockRejectedValueOnce(
      new Error("synthetic storage failure"),
    );
    await expect(
      h.service.invite("viewer", { memberNo: "28" }),
    ).rejects.toThrow("synthetic storage failure");
  });
  it("does not let the inviter accept or grant permissions", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "28" });
    await expect(
      h.service.respond("viewer", "relation-0", true),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.savePermissions("viewer", "relation-0", {
        metrics: ["heart_rate"],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.relationships[0].status).toBe("PENDING");
    expect(h.tx.carePermission.createMany).not.toHaveBeenCalled();
  });
  it("serializes responses and requires separate metric authorization", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "28" });
    const results = await Promise.allSettled(
      [true, false].map((accepted) =>
        h.service.respond("subject", "relation-0", accepted),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(h.relationships[0].status).toBe("ACTIVE");
    expect(h.tx.carePermission.deleteMany).toHaveBeenCalledTimes(2);
    expect(h.tx.carePermission.createMany).not.toHaveBeenCalled();
    await h.service.savePermissions("subject", "relation-0", {
      metrics: ["heart_rate"],
    });
    expect(h.tx.carePermission.createMany).toHaveBeenCalledOnce();
  });
  it("rejects late permission writes after revoke and on a re-invited pending relationship", async () => {
    const h = harness();
    await h.service.invite("viewer", { memberNo: "28" });
    await h.service.respond("subject", "relation-0", true);
    await h.service.revoke("subject", "relation-0");
    await expect(
      h.service.savePermissions("subject", "relation-0", {
        metrics: ["heart_rate"],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.invite("viewer", { memberNo: "28" }),
    ).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date(now.valueOf() + 60_001));
    await h.service.invite("viewer", { memberNo: "28" });
    expect(h.relationships[0].status).toBe("PENDING");
    await expect(
      h.service.savePermissions("subject", "relation-0", {
        metrics: ["heart_rate"],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.tx.carePermission.createMany).not.toHaveBeenCalled();
  });
});
