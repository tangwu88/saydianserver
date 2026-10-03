import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

function harness() {
  const feedback = {
    findMany: vi.fn(async () => [{
      id: "feedback-1", category: "account", content: "测试登录问题", status: "OPEN",
      user: { compatibilityId: 10008, nickname: "测试会员" }, createdAt: new Date("2026-09-12T01:00:00.000Z"),
    }]),
    update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    findUnique: vi.fn(async () => ({ id: "feedback-1", userId: "member-1", replyContent: null })),
  };
  const notification = { create: vi.fn(async ({ data }: any) => ({ id: "notification-1", ...data })) };
  const outboxEvent = { create: vi.fn(async (_input: any) => ({})) };
  const tx = { feedback, notification, outboxEvent, $executeRaw: vi.fn(async () => 1) };
  const prisma = { ...tx, $transaction: vi.fn(async (run: any) => run(tx)) };
  return { feedback, notification, outboxEvent, tx, service: new AdminService(prisma as any, {} as any) };
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
    expect(h.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "member-1", type: "SYSTEM", title: "您的反馈有新回复", body: "已核对并回复会员", deepLink: "/notifications", metadata: { feedbackId: "feedback-1" } }) });
    const event = h.outboxEvent.create.mock.calls[0]![0].data;
    expect(event).toMatchObject({ eventType: "system", aggregateType: "feedback", aggregateId: "feedback-1", payload: { userId: "member-1", notificationId: "notification-1", deepLink: "/notifications" } });
    expect(event.eventId).toBe(h.notification.create.mock.calls[0]![0].data.eventId);
    expect(JSON.stringify(event.payload)).not.toContain("已核对");
    expect(h.tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it("does not notify or reset the reply timestamp when saving the same reply again", async () => {
    const h = harness();
    h.feedback.findUnique.mockResolvedValueOnce({ id: "feedback-1", userId: "member-1", replyContent: "同一回复" } as any);
    await h.service.updateFeedback("feedback-1", { status: "RESOLVED", replyContent: " 同一回复 " }, { id: "admin-1" });
    expect(h.feedback.update).toHaveBeenCalledWith({ where: { id: "feedback-1" }, data: { status: "RESOLVED" } });
    expect(h.notification.create).not.toHaveBeenCalled();
    expect(h.outboxEvent.create).not.toHaveBeenCalled();
  });
  it("does not notify for a status-only update or anonymous feedback", async () => {
    const h = harness();
    await h.service.updateFeedback("feedback-1", { status: "IN_PROGRESS" }, { id: "admin-1" });
    h.feedback.findUnique.mockResolvedValueOnce({ id: "feedback-1", userId: null, replyContent: null } as any);
    await h.service.updateFeedback("feedback-1", { status: "RESOLVED", replyContent: "已处理反馈" }, { id: "admin-1" });
    expect(h.notification.create).not.toHaveBeenCalled();
    expect(h.outboxEvent.create).not.toHaveBeenCalled();
  });
  it("fails for a missing feedback without updating or notifying anyone", async () => {
    const h = harness();
    h.feedback.findUnique.mockResolvedValueOnce(null as any);
    await expect(h.service.updateFeedback("feedback-1", { status: "RESOLVED", replyContent: "已处理反馈" }, { id: "admin-1" })).rejects.toMatchObject({ status: 404 });
    expect(h.feedback.update).not.toHaveBeenCalled();
    expect(h.notification.create).not.toHaveBeenCalled();
  });

  it("rejects empty replies and unsupported fields before any write", async () => {
    const h = harness();
    await expect(h.service.updateFeedback("feedback-1", { status: "RESOLVED", replyContent: "" }, { id: "admin-1" })).rejects.toThrow("2至2000字");
    await expect(h.service.updateFeedback("feedback-1", { status: "RESOLVED", content: "篡改会员原文" }, { id: "admin-1" })).rejects.toThrow("不支持的字段");
    expect(h.feedback.update).not.toHaveBeenCalled();
  });
});
