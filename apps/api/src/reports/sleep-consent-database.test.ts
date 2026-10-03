import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { SLEEP_ANALYSIS_NOTICE } from "@saydian/app-contracts";
import type { PrismaService } from "../common/prisma.service";
import { SleepReportsService } from "./sleep-reports.service";

// Exact synthetic fixtures in an explicitly opted-in loopback database only.
describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")("local sleep consent transaction acceptance", () => {
  const memberId = randomUUID(), noticeId = randomUUID(), version = `LOCAL_SLEEP_${randomUUID()}`;
  let prisma: PrismaClient, service: SleepReportsService, originalHealthProfile: unknown;
  let createdMember = false, createdNotice = false;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Non-local database tests refused");
    prisma = new PrismaClient();
    service = new SleepReportsService(prisma as PrismaService);
    await prisma.user.create({ data: { id: memberId, nickname: `LOCAL_SLEEP_${memberId}`, locale: "zh-Hans" } });
    createdMember = true;
    await prisma.globalLegalDocument.create({ data: { id: noticeId, documentType: SLEEP_ANALYSIS_NOTICE, version, locale: "zh-Hans", title: "Local synthetic notice", contentHtml: "<p>Local synthetic consent test only.</p>", reviewed: true, active: true, publishedAt: new Date() } });
    createdNotice = true;
    originalHealthProfile = await prisma.healthProfile.create({ data: { userId: memberId, analysisConsentVersion: "LOCAL_HEALTH_UNCHANGED", analysisConsentedAt: new Date("2026-08-01T00:00:00Z") } });
    await prisma.consentRecord.create({ data: { userId: memberId, documentType: "health_ai_analysis", version: "LOCAL_HEALTH_UNCHANGED", source: "local_synthetic_test" } });
  });
  afterAll(async () => {
    if (!prisma) return;
    if (createdNotice) await prisma.globalLegalDocument.delete({ where: { id: noticeId } });
    if (createdMember) await prisma.user.delete({ where: { id: memberId } });
    await prisma.$disconnect();
  });
  it("serializes repeated grants under the member row lock without touching Health App", async () => {
    const grants = await Promise.all([1, 2, 3].map(() => service.setAnalysisConsent(memberId, { granted: true, version })));
    expect(grants.every(value => value.granted)).toBe(true);
    expect(await prisma.consentRecord.count({ where: { userId: memberId, documentType: SLEEP_ANALYSIS_NOTICE } })).toBe(1);
    expect(await prisma.healthProfile.findUnique({ where: { userId: memberId } })).toEqual(originalHealthProfile);
  });
  it("withdrawal only changes this product's grant, including concurrent withdrawals", async () => {
    await Promise.all([1, 2].map(() => service.setAnalysisConsent(memberId, { granted: false })));
    expect(await prisma.consentRecord.findFirst({ where: { userId: memberId, documentType: SLEEP_ANALYSIS_NOTICE } })).toHaveProperty("withdrawnAt", expect.any(Date));
    expect(await prisma.consentRecord.findFirst({ where: { userId: memberId, documentType: "health_ai_analysis" } })).toHaveProperty("withdrawnAt", null);
    expect(await prisma.healthProfile.findUnique({ where: { userId: memberId } })).toEqual(originalHealthProfile);
  });
  it("rejects an old notice and preserves a newer regrant timestamp", async () => {
    await expect(service.setAnalysisConsent(memberId, { granted: true, version: "LOCAL_OLD" })).rejects.toThrow(/更新/);
    const before = await prisma.consentRecord.findFirstOrThrow({ where: { userId: memberId, documentType: SLEEP_ANALYSIS_NOTICE } });
    await service.setAnalysisConsent(memberId, { granted: true, version });
    const after = await prisma.consentRecord.findFirstOrThrow({ where: { userId: memberId, documentType: SLEEP_ANALYSIS_NOTICE } });
    expect(after.withdrawnAt).toBeNull();
    expect(after.acceptedAt.getTime()).toBeGreaterThanOrEqual(before.acceptedAt.getTime());
    expect(await prisma.healthProfile.findUnique({ where: { userId: memberId } })).toEqual(originalHealthProfile);
  });
});
