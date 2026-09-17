import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("withdrawal review UI", () => {
  it("shows submitted payout details and makes approval the final withdrawn state", () => {
    const source = readFileSync(new URL("./views/CommerceWithdrawalsView.vue", import.meta.url), "utf8");
    expect(source).toContain("row.payoutDetails?.accountName");
    expect(source).toContain("row.payoutDetails?.payoutAccount");
    expect(source).toContain("审核通过，已记为已提现");
    expect(source).toContain("冻结佣金转入累计已付");
    expect(source).toContain('SUCCEEDED: "已提现"');
  });
});
