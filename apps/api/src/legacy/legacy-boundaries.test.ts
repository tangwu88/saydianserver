import { describe, expect, it, vi } from "vitest";
import { ContentService } from "../content/content.service";
import { CommerceService } from "../commerce/commerce.service";
import { CareService } from "../care/care.service";
import { LegacyService } from "./legacy.service";
import { LegacyCommerceMapper } from "./legacy-commerce-mapper.service";
import type { PrismaService } from "../common/prisma.service";

describe("legacy identifiers and payment boundaries", () => {
  it("does not send numeric legacy article IDs to a UUID column", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "article", legacyId: "17" });
    const content = new ContentService({ article: { findFirst } } as unknown as PrismaService);
    await content.article("17");
    expect(findFirst.mock.calls[0]?.[0].where.OR).toEqual([{ legacyId: "17" }]);
  });

  it("looks up numeric notification IDs only in compatible columns and with ownership", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "notification" });
    const legacy = new LegacyService({ notification: { findFirst } } as unknown as PrismaService);
    await expect(legacy.notificationId("owner", "42")).resolves.toBe("notification");
    expect(findFirst.mock.calls[0]?.[0].where).toEqual({
      userId: "owner", OR: [{ eventId: "42" }, { compatibilityId: 42 }],
    });
  });

  it.each([["1", "wechat_app"], ["2", "alipay_app"], ["100", "wechat_app"], ["101", "alipay_app"]])(
    "maps released payment code %s to mall channel %s", async (payType, channel) => {
      const mapper = new LegacyCommerceMapper({ externalIdIfMapped: vi.fn().mockResolvedValue("mall-order") } as unknown as LegacyService);
      await expect(mapper.paymentRequest({ pay_type: payType, trade_type: "app", data: '{"order_id":12}' }))
        .resolves.toMatchObject({ orderId: "mall-order", channel, trade_type: "app" });
    },
  );

  it("blocks historical-order payment before touching the mall", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "projection" });
    const findUnique = vi.fn();
    const commerce = new CommerceService({ legacyOrderProjection: { findFirst }, commerceIdentityMap: { findUnique } } as unknown as PrismaService);
    await expect(commerce.forUser("owner", "POST", "/payments", { orderId: "9527" })).rejects.toThrow("历史订单仅供查看");
    expect(findFirst.mock.calls[0]?.[0].where).toEqual({ userId: "owner", OR: [{ legacyOrderId: "9527" }] });
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("care reinvitation", () => {
  const relation = { id: "relation", invitationId: "invitation", inviterId: "viewer", recipientId: "subject", status: "PENDING", expiresAt: null, createdAt: new Date(), updatedAt: new Date() };
  function fixture(status: string) {
    const tx = {
      careRelationship: { findUnique: vi.fn().mockResolvedValue({ ...relation, status }), upsert: vi.fn().mockResolvedValue(relation) },
      carePermission: { deleteMany: vi.fn() },
      notification: { upsert: vi.fn().mockResolvedValue({ id: "notice" }) },
      outboxEvent: { upsert: vi.fn() },
    };
    const service = new CareService({ user: { findUnique: vi.fn().mockResolvedValue({ id: "subject" }) }, $transaction: (run: (db: unknown) => unknown) => run(tx) } as unknown as PrismaService);
    return { service, tx };
  }
  it("does not reset active permissions when an inviter clicks again", async () => {
    const { service, tx } = fixture("ACTIVE");
    await expect(service.invite("viewer", "13800000000")).rejects.toThrow("已建立关爱关系");
    expect(tx.careRelationship.upsert).not.toHaveBeenCalled();
    expect(tx.carePermission.deleteMany).not.toHaveBeenCalled();
  });
  it("does not send another notification for an already pending invitation", async () => {
    const { service, tx } = fixture("PENDING");
    await expect(service.invite("viewer", "13800000000")).resolves.toMatchObject({ id: "relation", invitationId: "invitation" });
    expect(tx.notification.upsert).not.toHaveBeenCalled();
  });
  it("clears old permissions before sending a new invitation", async () => {
    const { service, tx } = fixture("REVOKED");
    await service.invite("viewer", "13800000000");
    expect(tx.carePermission.deleteMany).toHaveBeenCalledWith({ where: { relationshipId: "relation" } });
  });
});
