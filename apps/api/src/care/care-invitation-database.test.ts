import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, HealthMetric } from "@prisma/client";
import type { PrismaService } from "../common/prisma.service";
import { sha256 } from "../common/crypto";
import { CareService } from "./care.service";
import { LegacyService } from "../legacy/legacy.service";

// Opt-in, owned fixtures in an explicitly named loopback test DB. Never probes
// a real account, sends a provider notification or calls a production service.
describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")(
  "care invitation PostgreSQL races",
  () => {
    const marker = `LOCAL_CARE_${randomUUID()}`,
      ids: string[] = [],
      keys: string[] = [];
    let db: PrismaClient,
      service: CareService,
      legacy: LegacyService,
      viewer: { id: string },
      other: { id: string },
      subject: { id: string; compatibilityId: number },
      relationId: string;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        process.env.NODE_ENV !== "test" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !/^\/[a-z0-9_]*test[a-z0-9_]*$/i.test(url.pathname)
      )
        throw new Error(
          "Only an opted-in named loopback test database is allowed",
        );
      db = new PrismaClient();
      service = new CareService(db as PrismaService);
      legacy = new LegacyService(db as PrismaService);
      viewer = await db.user.create({ data: { nickname: marker } });
      ids.push(viewer.id);
      subject = await db.user.create({ data: { nickname: marker } });
      ids.push(subject.id);
      other = await db.user.create({ data: { nickname: marker } });
      ids.push(other.id);
      keys.push(
        `care-invite:account:${sha256(viewer.id)}`,
        `care-invite:account:${sha256(other.id)}`,
        `care-invite:target:${sha256(`memberNo:${subject.compatibilityId}`)}`,
      );
    });
    afterAll(async () => {
      if (!db) return;
      for (const id of ids) {
        const user = await db.user.findUnique({
          where: { id },
          select: { nickname: true },
        });
        if (user && user.nickname !== marker)
          throw new Error("Fixture ownership changed; refusing cleanup");
      }
      const relations = await db.careRelationship.findMany({
        where: { inviterId: { in: ids }, recipientId: { in: ids } },
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
        where: { id: { in: ids }, nickname: marker },
      });
      await db.$disconnect();
    });
    it("serializes concurrent exact-pair requests into one pending invitation and one outbox event", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          service.invite(viewer.id, {
            memberNo: String(subject.compatibilityId),
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toEqual([
        { status: "fulfilled", value: { invitationSubmitted: true } },
      ]);
      expect(
        results
          .filter((r) => r.status === "rejected")
          .map((r) => (r as PromiseRejectedResult).reason.status),
      ).toEqual([429, 429, 429]);
      const relations = await db.careRelationship.findMany({
        where: { inviterId: viewer.id, recipientId: subject.id },
      });
      expect(relations).toHaveLength(1);
      relationId = relations[0]!.id;
      expect(relations[0]!.status).toBe("PENDING");
      expect(relations[0]!.identityDisclosure).toBe("MEMBER_NO_PENDING");
      expect(await service.relationships(viewer.id)).toEqual([]);
      expect(await legacy.careRows(viewer.id, false)).toEqual([]);
      expect(await service.relationships(subject.id)).toHaveLength(1);
      const received = await legacy.careRows(subject.id, false);
      expect(received).toHaveLength(1);
      expect(received[0]!.member).not.toHaveProperty("mobile");
      expect(received[0]!.member).not.toHaveProperty("birthday");
      await expect(
        legacy.relationshipByCompatibilityId(
          relations[0]!.compatibilityId,
          viewer.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        legacy.relationshipByCompatibilityId(
          relations[0]!.compatibilityId,
          other.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.revoke(viewer.id, relationId)).rejects.toMatchObject(
        { status: 404 },
      );
      expect(
        await db.notification.count({ where: { userId: subject.id } }),
      ).toBe(1);
      expect(
        await db.outboxEvent.count({
          where: {
            aggregateType: "care_relationship",
            aggregateId: relationId,
          },
        }),
      ).toBe(1);
      expect(
        await db.carePermission.count({
          where: { relationshipId: relationId },
        }),
      ).toBe(0);
      await expect(
        service.invite(other.id, { memberNo: String(subject.compatibilityId) }),
      ).rejects.toMatchObject({ status: 429 });
    });
    it("does not grant health access before acceptance or before explicit metric permission", async () => {
      // Reproduce an old/raced pending row containing stale permissions.
      await db.carePermission.create({
        data: { relationshipId: relationId, metric: HealthMetric.HEART_RATE },
      });
      await expect(
        service.authorizedSubject(
          viewer.id,
          relationId,
          HealthMetric.HEART_RATE,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.respond(viewer.id, relationId, true),
      ).rejects.toMatchObject({ status: 404 });
      await service.respond(subject.id, relationId, true);
      expect(await service.relationships(viewer.id)).toHaveLength(1);
      const accepted = await db.careRelationship.findUniqueOrThrow({
        where: { id: relationId },
      });
      expect(accepted.identityDisclosure).toBe("MEMBER_NO_ACCEPTED");
      expect(
        (await legacy.careRows(viewer.id, true))[0]!.member,
      ).not.toHaveProperty("mobile");
      await expect(
        legacy.relationshipByCompatibilityId(
          accepted.compatibilityId,
          viewer.id,
        ),
      ).resolves.toHaveProperty("id", relationId);
      expect(
        await db.carePermission.count({
          where: { relationshipId: relationId },
        }),
      ).toBe(0);
      await expect(
        service.authorizedSubject(
          viewer.id,
          relationId,
          HealthMetric.HEART_RATE,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await service.savePermissions(subject.id, relationId, {
        metrics: ["heart_rate"],
      });
      await expect(
        service.authorizedSubject(
          viewer.id,
          relationId,
          HealthMetric.HEART_RATE,
        ),
      ).resolves.toBe(subject.id);
      await expect(
        service.authorizedSubject(
          viewer.id,
          relationId,
          HealthMetric.BLOOD_OXYGEN,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("ends revoked with no permission even when permission saving races revocation", async () => {
      await Promise.allSettled([
        service.savePermissions(subject.id, relationId, {
          metrics: ["heart_rate", "blood_oxygen"],
        }),
        service.revoke(viewer.id, relationId),
      ]);
      expect(
        await db.careRelationship.findUniqueOrThrow({
          where: { id: relationId },
        }),
      ).toHaveProperty("status", "REVOKED");
      expect(
        await db.carePermission.count({
          where: { relationshipId: relationId },
        }),
      ).toBe(0);
      await expect(
        service.authorizedSubject(
          viewer.id,
          relationId,
          HealthMetric.HEART_RATE,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("keeps cooldown and clears old grants on re-invitation", async () => {
      await expect(
        service.invite(viewer.id, {
          memberNo: String(subject.compatibilityId),
        }),
      ).rejects.toMatchObject({ status: 429 });
      // Advance only this test's exact reservation keys, not real auth or other fixtures.
      await db.globalVerificationThrottle.updateMany({
        where: { key: { in: keys } },
        data: { reservedAt: new Date(Date.now() - 120_000) },
      });
      expect(
        await service.invite(viewer.id, {
          memberNo: String(subject.compatibilityId),
        }),
      ).toEqual({ invitationSubmitted: true });
      expect(
        await db.careRelationship.findUniqueOrThrow({
          where: { id: relationId },
        }),
      ).toHaveProperty("status", "PENDING");
      expect(await service.relationships(viewer.id)).toEqual([]);
      expect(await legacy.careRows(viewer.id, false)).toEqual([]);
      await expect(
        service.savePermissions(subject.id, relationId, {
          metrics: ["heart_rate"],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await db.carePermission.count({
          where: { relationshipId: relationId },
        }),
      ).toBe(0);
      expect(
        await db.notification.count({ where: { userId: subject.id } }),
      ).toBe(2);
    });
    it("keeps rejected and revoked unaccepted numbered identities private", async () => {
      await service.respond(subject.id, relationId, false);
      expect(await service.relationships(viewer.id)).toEqual([]);
      expect(await legacy.careRows(viewer.id, false)).toEqual([]);
      await service.revoke(subject.id, relationId);
      expect(await service.relationships(viewer.id)).toEqual([]);
      expect(await legacy.careRows(viewer.id, false)).toEqual([]);
    });
    it("preserves contact defaults and cadence without consuming numbered reservations", async () => {
      await db.user.update({
        where: { id: subject.id },
        data: { email: `${marker.toLowerCase()}@example.invalid` },
      });
      const contact = await service.invite(
        other.id,
        `${marker.toLowerCase()}@example.invalid`,
      );
      const row = await db.careRelationship.findUniqueOrThrow({
        where: { id: contact.id },
      });
      expect(row.identityDisclosure).toBe("CONTACT");
      expect(await service.relationships(other.id)).toHaveLength(1);
      expect(
        (await legacy.careRows(other.id, false))[0]!.member,
      ).toHaveProperty("mobile");
      await expect(
        service.invite(other.id, `${marker.toLowerCase()}@example.invalid`),
      ).resolves.toHaveProperty("id", row.id);
      await expect(
        service.invite(viewer.id, `${marker.toLowerCase()}@example.invalid`),
      ).resolves.toHaveProperty("status", "pending");
    });
  },
);
