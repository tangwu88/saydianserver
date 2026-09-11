import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

function harness() {
  const feedback = {
    findMany: vi.fn(async () => [{
      id: "feedback-1", category: "account", content: "测试登录问题", status: "OPEN",
      user: { compatibilityId: 10008, nickname: "测试会员" }, createdAt: new Date("2026-09-12T01:00:00.000Z"),
    }]),
    update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
  };
  return { feedback, service: new AdminService({ feedback } as any, {} as any) };
}

describe("administrator feedback workflow", () => {
  it("shows readable member identity without returning the joined user object", async () => {
    const h = harness();
    const rows = await h.service.feedback("open");
    expect(h.feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "OPEN" } }));
    expect(rows[0]).toMatchObject({ memberNo: "10008", memberNickname: "测试会员" });
    expect(rows[0]).not.toHaveProperty("user");
  });

  it("stores the reply, reply time and responsible administrator", async () => {
    const h = harness();
    const saved = await h.service.updateFeedback("feedback-1", { status: "resolved", replyContent: " 已核对并回复会员 " }, { id: "11111111-1111-4111-8111-111111111111" });
    expect(saved).toMatchObject({ id: "feedback-1", status: "RESOLVED", replyContent: "已核对并回复会员", repliedBy: "11111111-1111-4111-8111-111111111111" });
    expect(h.feedback.update).toHaveBeenCalledWith({ where: { id: "feedback-1" }, data: expect.objectContaining({ status: "RESOLVED", repliedAt: expect.any(Date) }) });
  });

  it("rejects empty replies and unsupported fields before any write", async () => {
    const h = harness();
    await expect(h.service.updateFeedback("feedback-1", { status: "RESOLVED", replyContent: "" }, { id: "admin-1" })).rejects.toThrow("2至2000字");
    await expect(h.service.updateFeedback("feedback-1", { status: "RESOLVED", content: "篡改会员原文" }, { id: "admin-1" })).rejects.toThrow("不支持的字段");
    expect(h.feedback.update).not.toHaveBeenCalled();
  });
});
