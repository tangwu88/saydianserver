import { describe, expect, it, vi } from "vitest";
import { globalLegalBundle } from "./global-legal";

function document(type: string, locale = "en", version = "global-2026-09") { return { documentType: type, locale, version, contentHtml: "Synthetic reviewed document" }; }
describe("published global legal consent bundle", () => {
  it("does not invent a consent version when no reviewed text is available", async () => {
    const findMany = vi.fn(async () => []); expect(await globalLegalBundle({ globalLegalDocument: { findMany } } as any, "en")).toBeNull();
    expect((findMany.mock.calls[0] as any)[0].where).toMatchObject({ active: true, reviewed: true, publishedAt: { lte: expect.any(Date) } });
  });
  it("requires a terms/privacy pair with the same published version", async () => {
    const rows = [document("user_agreement"), document("privacy_policy", "en", "older")];
    expect(await globalLegalBundle({ globalLegalDocument: { findMany: async () => rows } } as any, "en")).toBeNull();
  });
  it("selects requested language and explicitly identifies the served locale", async () => {
    const rows = [document("user_agreement", "de"), document("privacy_policy", "de"), document("user_agreement"), document("privacy_policy")];
    const result = await globalLegalBundle({ globalLegalDocument: { findMany: async () => rows } } as any, "de-DE");
    expect(result?.locale).toBe("de"); expect(result?.documents.userAgreement.path).toContain("locale=de");
  });
  it("falls back only to an explicitly reviewed English pair", async () => {
    const rows = [document("user_agreement", "fr"), document("user_agreement"), document("privacy_policy")];
    expect((await globalLegalBundle({ globalLegalDocument: { findMany: async () => rows } } as any, "fr"))?.locale).toBe("en");
  });
  it("rejects an empty document body", async () => {
    const rows = [{ ...document("user_agreement"), contentHtml: " " }, document("privacy_policy")];
    expect(await globalLegalBundle({ globalLegalDocument: { findMany: async () => rows } } as any, "en")).toBeNull();
  });
});
