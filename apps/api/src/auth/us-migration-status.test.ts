import { describe, expect, it } from "vitest";
import { usMigrationStatus } from "./us-migration-status";
const id = "00000000-0000-4000-8000-000000000001";
const proof = { schemaVersion: 1, completed: true, batchId: "00000000-0000-4000-8000-000000000002", sourceOrigin: "https://app.saydian.cn", targetOrigin: "https://app.saydian.com", sourceAccountId: id, targetAccountId: id, verifiedAt: "2026-10-14T00:00:00.000Z" };
describe("authenticated US account migration evidence", () => {
  it("exposes only verified mapping for the authenticated account", () => {
    expect(usMigrationStatus(id, { ...proof, privateExport: "secret" }, "us")).toEqual(proof);
  });
  it("keeps missing, incomplete, other-site and other-account evidence closed", () => {
    expect(usMigrationStatus(id, proof, "cn")).toEqual({ completed: false });
    for (const value of [null, {}, { ...proof, completed: false }, { ...proof, sourceAccountId: proof.batchId }, { ...proof, targetAccountId: proof.batchId }, { ...proof, targetOrigin: "https://other.example" }, { ...proof, verifiedAt: "invalid" }]) {
      expect(usMigrationStatus(id, value, "us")).toEqual({ completed: false });
    }
  });
});
