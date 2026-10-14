import { describe, expect, it } from "vitest";
import { accountClassification, internationalConsentSource } from "./us-inventory";
describe("US candidates require actual international consent evidence", () => {
  it("accepts known registration channels without assuming English means international", () => {
    for (const source of ["global_app_v2:en", "global_app_v2_unverified:de", "global_app_v2_password:zh-Hans", "global_h5_code:fr"]) expect(internationalConsentSource(source)).toBe(true);
    for (const source of ["app_v2", "global_app_v2:say-ring:en", "global_app_v2:unknown", "en", ""]) expect(internationalConsentSource(source)).toBe(false);
  });
  it("flags mixed accounts and unattributed evidence for review", () => {
    expect(accountClassification(["global_app_v2:en"])).toBe("international-candidate");
    expect(accountClassification(["global_app_v2:en", "app_v2"])).toBe("shared-review-required");
    expect(accountClassification(["global_app_v2:say-ring:en"])).toBe("unattributed");
  });
});
