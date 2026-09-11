import { describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";

function harness() {
  const feedback = {
    create: vi.fn(async ({ data }: any) => ({ id: "feedback-1", status: "OPEN", ...data })),
    findMany: vi.fn(async () => [{
      id: "feedback-1", category: "shopping", content: "测试订单无法付款", status: "RESOLVED",
      replyContent: "已为您核对，请重新发起付款", repliedAt: new Date("2026-09-12T02:00:00.000Z"),
      createdAt: new Date("2026-09-12T01:00:00.000Z"), updatedAt: new Date("2026-09-12T02:00:00.000Z"),
    }]),
  };
  const fileObject = { count: vi.fn(async () => 1) };
  const service = new SupportService({ feedback, fileObject } as any, {} as any);
  return { service, feedback, fileObject };
}

describe("member feedback and administrator replies", () => {
  it("creates feedback only for the authenticated member and returns a safe receipt", async () => {
    const h = harness();
    const result = await h.service.createFeedback("member-1", {
      category: "shopping", content: " 测试订单无法付款 ", contact: "member@example.com", attachments: ["file-1"],
    });
    expect(result).toEqual({ id: "feedback-1", status: "open" });
    expect(h.feedback.create).toHaveBeenCalledWith({ data: {
      userId: "member-1", category: "shopping", content: "测试订单无法付款",
      contact: "member@example.com", attachments: ["file-1"],
    } });
    expect(h.fileObject.count).toHaveBeenCalledWith({ where: { id: { in: ["file-1"] }, ownerUserId: "member-1", status: "ACTIVE" } });
  });

  it("lists only the current member's feedback with visible reply fields", async () => {
    const h = harness();
    const rows = await h.service.listFeedback("member-1");
    expect(h.feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "member-1" }, take: 100 }));
    expect(rows[0]).toMatchObject({ id: "feedback-1", status: "resolved", replyContent: "已为您核对，请重新发起付款" });
    expect(rows[0]).not.toHaveProperty("repliedBy");
  });

  it("rejects incomplete feedback and attachments that do not belong to the member", async () => {
    const h = harness();
    await expect(h.service.createFeedback("member-1", { content: "太短" })).rejects.toThrow("5至2000字");
    h.fileObject.count.mockResolvedValueOnce(0);
    await expect(h.service.createFeedback("member-1", { content: "测试反馈附件归属", attachments: ["foreign-file"] })).rejects.toThrow("附件不正确");
    expect(h.feedback.create).not.toHaveBeenCalled();
  });
});
