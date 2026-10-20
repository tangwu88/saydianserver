import { describe, expect, it } from "vitest";
import { orderPurchaser } from "./commerce-order-purchaser";

describe("order purchaser identity", () => {
  it("shows the partner who owns a purchase instead of an unnamed member or recipient", () => {
    expect(orderPurchaser({ partnerId: "partner-1", user: null,
      partner: { id: "partner-1", name: "华南合作伙伴", partnerNo: "VIP-001" },
    })).toMatchObject({ kind: "partner", label: "品牌伙伴下单", name: "华南合作伙伴", reference: "VIP-001", contact: "" });
  });
  it("uses the member account even when that member belongs to a partner", () => {
    const order = { userId: "member-1", partnerId: null, recipientName: "其他收货人",
      user: { id: "member-1", nickname: "李明", mobile: "138****0000", partnerId: "referrer-1" },
      referralEmployeeId: "promoter-1", orderNo: "VP-not-an-identity", sourceSystem: "partner-promotion",
    };
    expect(orderPurchaser(order)).toMatchObject({ kind: "member", name: "李明", contact: "138****0000" });
  });
  it("keeps a partner identity when relation details are unavailable", () => {
    expect(orderPurchaser({ partnerId: "partner-1", partner: null })).toMatchObject({ kind: "partner", name: "未命名品牌伙伴", reference: "partner-1" });
  });
  it("handles relation-only projections without guessing from order numbers", () => {
    expect(orderPurchaser({ user: { id: "member-1", nickname: null } })).toMatchObject({ kind: "member", name: "未命名会员" });
    expect(orderPurchaser({ partner: { id: "partner-1", name: "月" } })).toMatchObject({ kind: "partner", name: "月" });
  });
  it("does not mislabel incomplete or conflicting historical ownership as a member", () => {
    expect(orderPurchaser({})).toMatchObject({ kind: "unknown", label: "下单身份未获取" });
    expect(orderPurchaser({ userId: "member-1", partnerId: "partner-1" })).toMatchObject({ kind: "unknown", label: "下单身份待核实", name: "—" });
  });
});
