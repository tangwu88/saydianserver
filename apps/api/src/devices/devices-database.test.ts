import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { DevicesService } from "./devices.service";

// Only an explicitly enabled loopback fixture database; no real members/rings.
describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")("first ring binding PostgreSQL acceptance", () => {
  let prisma: PrismaClient;
  let service: DevicesService;
  const users: string[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Non-local database refused");
    prisma = new PrismaClient(); service = new DevicesService(prisma as any);
  });
  afterAll(async () => {
    if (prisma) { await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); }
  });
  async function member() {
    const u = await prisma.user.create({ data: { nickname: `SYNTHETIC_FIRST_RING_${randomUUID()}` } });
    users.push(u.id); return u.id;
  }
  function ring(id: string, initialize = true) {
    return { deviceId: id, vendor: "CoolWear", model: "R7Pro", displayName: "SYNTHETIC_RING",
      ...(initialize ? { product: "say-ring", initializeFirstBinding: true } : {}) };
  }
  it("two concurrent first devices get exactly one grant; repeats get none", async () => {
    const id = await member();
    const results = await Promise.all([service.bind(id, ring("fixture:a")), service.bind(id, ring("fixture:b"))]);
    expect(results.filter(x => x.firstBindingInitialization?.shouldClear)).toHaveLength(1);
    expect((await service.bind(id, ring("fixture:a"))).firstBindingInitialization?.shouldClear).toBe(false);
  });
  it("unbound lifetime history and a new model still prevent clearing", async () => {
    const id = await member(); const old = await service.bind(id, ring("fixture:old", false));
    await service.unbind(id, old.id); expect(await service.list(id)).toEqual([]);
    expect((await service.bind(id, ring("fixture:new"))).firstBindingInitialization?.shouldClear).toBe(false);
  });
  it("an old client report is also serialized and protects its member", async () => {
    const id = await member(); await service.bind(id, ring("fixture:legacy", false));
    expect((await service.bind(id, ring("fixture:new"))).firstBindingInitialization?.shouldClear).toBe(false);
    expect((await service.bind(await member(), ring("fixture:other-member"))).firstBindingInitialization?.shouldClear).toBe(true);
  });
});
