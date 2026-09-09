import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxWorker } from "./outbox-worker";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import type { PushProvider } from "./push-provider";

const previous = process.env.MAINTENANCE_READ_ONLY;
afterEach(() => {
  if (previous === undefined) delete process.env.MAINTENANCE_READ_ONLY;
  else process.env.MAINTENANCE_READ_ONLY = previous;
});
describe("worker cutover pause", () => {
  it("does not claim or deliver jobs while business writes are frozen", async () => {
    process.env.MAINTENANCE_READ_ONLY = "true";
    const findMany = vi.fn();
    const updateMany = vi.fn();
    const worker = new OutboxWorker({ outboxEvent: { findMany, updateMany } } as unknown as PrismaClient, {} as Redis, {} as PushProvider);
    expect(await worker.runOnce()).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
