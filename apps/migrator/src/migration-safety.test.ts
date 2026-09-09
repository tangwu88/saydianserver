import { describe, expect, it, vi } from "vitest";
import { compatiblePasswordHash, LegacyMigrator, rowDigest, sourceMoneyCents } from "./migrator";
import type { MigrationMap } from "./config";
import type { PrismaClient } from "@prisma/client";
import type { Connection } from "mysql2/promise";
import { sourceCents } from "./mall-migrator";

describe("migration safety", () => {
  it("accepts only complete supported bcrypt hashes, never a guessed legacy algorithm", () => {
    const bcrypt = `$2y$10$${"a".repeat(53)}`;
    expect(compatiblePasswordHash(bcrypt)).toBe(bcrypt);
    expect(compatiblePasswordHash("$2b$12$truncated")).toBeNull();
    expect(compatiblePasswordHash("5f4dcc3b5aa765d61d8327deb882cf99")).toBeNull();
    expect(compatiblePasswordHash(`$2b$31$${"a".repeat(53)}`)).toBeNull();
  });
  it("uses explicit units and exact cents, leaving unknown monetary data unknown", () => {
    expect(sourceMoneyCents("19.99", "yuan")).toBe(1999);
    expect(sourceMoneyCents("0", "yuan")).toBe(0);
    expect(sourceMoneyCents(null, "yuan")).toBeNull();
    expect(sourceMoneyCents("19.999", "yuan")).toBeNull();
    expect(sourceMoneyCents("100", undefined)).toBeNull();
    expect(sourceMoneyCents("1.01", "cents")).toBeNull();
  });
  it("has stable source digests but notices an updated source field", () => {
    expect(rowDigest({ id: 1, status: "PAID" })).toBe(rowDigest({ status: "PAID", id: 1 }));
    expect(rowDigest({ id: 1, status: "PAID" })).not.toBe(rowDigest({ id: 1, status: "REFUNDED" }));
  });
  it("never fabricates zero for missing legacy-mall money and preserves signed ledger cents", () => {
    expect(sourceCents(-125)).toBe(-125);
    expect(sourceCents("0")).toBe(0);
    for (const invalid of [undefined, null, "", "1.01", NaN, Infinity, 2147483648]) expect(() => sourceCents(invalid)).toThrow();
  });
  it("does not treat unresolved conflicts as successfully migrated records", async () => {
    const target = {
      migrationRun: { findUniqueOrThrow: async () => ({ id: "run-1" }), update: vi.fn() },
      legacyIdMap: { count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) },
      migrationConflict: { count: vi.fn().mockResolvedValue(1) },
    };
    const source = { query: async () => [[{ count: 2, firstId: 1, lastId: 2 }]] };
    const map = { sourceLabel: "reviewed-source", member: { table: "member", id: "id" }, healthSources: [] } as unknown as MigrationMap;
    const report = await new LegacyMigrator(source as unknown as Connection, target as unknown as PrismaClient, map).verify("run-1");
    expect(report.matched).toBe(false);
    expect(target.migrationRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });
});
