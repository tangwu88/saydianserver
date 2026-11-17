import { describe, expect, it, vi } from "vitest";
import { cancelAccountDeletion } from "./account-deletion-cancellation";

const userId = "00000000-0000-4000-8000-000000000123";
const id = "00000000-0000-4000-8000-000000000456";
const requestedAt = new Date("2026-11-10T00:00:00.000Z");
const actor = { id: "test-admin", role: "SUPER_ADMIN" };
const input = { expectedUserId: userId, expectedRequestedAt: requestedAt.toISOString(), confirm: true, reason: "会员明确要求撤销注销" };
function harness(status = "REQUESTED", userStatus = "DELETION_PENDING") {
  let state = { user: { id: userId, status: userStatus }, tasks: [{ id, userId, status, requestedAt }], audit: [] as unknown[] };
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: userId }]),
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...state.user })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.status !== state.user.status) return { count: 0 };
        state.user.status = data.status; return { count: 1 };
      }),
    },
    accountDeletionRequest: {
      findMany: vi.fn(async () => state.tasks.map(task => ({ ...task }))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matches = state.tasks.filter(task => task.status === where.status && where.id.in.includes(task.id));
        matches.forEach(task => { task.status = data.status; }); return { count: matches.length };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { state.audit.push(data); return data; }) },
  };
  const prisma = { $transaction: vi.fn(async (run: any) => {
    const before = structuredClone(state);
    try { return await run(tx); } catch (error) { state = before; throw error; }
  }) };
  return { tx, prisma, state: () => state, run: (body: unknown = input, current = actor, target = id) => cancelAccountDeletion(prisma as any, current, target, body, "test-request") };
}
describe("audited cancellation of pending account deletion", () => {
  it("cancels duplicate queued requests atomically and restores only account status", async () => {
    const h = harness();
    h.state().tasks.push({ ...h.state().tasks[0]!, id: "00000000-0000-4000-8000-000000000789" });
    expect(await h.run()).toMatchObject({ status: "CANCELLED", userStatus: "ACTIVE", alreadyCancelled: false });
    expect(h.state().tasks.every(task => task.status === "CANCELLED")).toBe(true);
    expect(h.tx.user.updateMany).toHaveBeenCalledWith({ where: { id: userId, status: "DELETION_PENDING" }, data: { status: "ACTIVE" } });
    expect(h.state().audit).toMatchObject([{ action: "ACCOUNT_DELETION_CANCELLED", actorId: "test-admin", entityId: userId, requestId: "test-request", afterJson: { reason: input.reason } }]);
  });
  it.each(["PROCESSING", "FAILED", "COMPLETED"])("rejects %s, including a worker that claimed before cancellation", async status => {
    const h = harness(status);
    await expect(h.run()).rejects.toMatchObject({ status: 409 });
    expect(h.tx.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
    expect(h.state().user.status).toBe("DELETION_PENDING");
  });
  it.each(["DISABLED", "DELETED", "ACTIVE"])("does not restore %s accounts", async status => {
    const h = harness("REQUESTED", status);
    await expect(h.run()).rejects.toMatchObject({ status: 409 });
    expect(h.state().tasks[0]!.status).toBe("REQUESTED");
  });
  it("rolls back all changes if the audit cannot be written", async () => {
    const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(h.run()).rejects.toThrow("audit unavailable");
    expect(h.state().user.status).toBe("DELETION_PENDING");
    expect(h.state().tasks[0]!.status).toBe("REQUESTED");
  });
  it("fails closed if a worker wins the compare-and-set", async () => {
    const h = harness(); h.tx.accountDeletionRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(h.run()).rejects.toMatchObject({ status: 409 });
    expect(h.tx.user.updateMany).not.toHaveBeenCalled();
  });
  it("retries the same completed cancellation safely without restoring old sessions", async () => {
    const h = harness(); await h.run();
    expect(await h.run()).toMatchObject({ alreadyCancelled: true });
    expect(h.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it("does not cancel a later deletion using a stale cancelled request", async () => {
    const h = harness("CANCELLED");
    h.state().tasks.push({ ...h.state().tasks[0]!, id: "00000000-0000-4000-8000-000000000789", status: "REQUESTED" });
    await expect(h.run()).rejects.toMatchObject({ status: 409 });
    expect(h.tx.user.updateMany).not.toHaveBeenCalled();
  });
  it("rejects a task from another user and a changed request timestamp", async () => {
    const h = harness();
    await expect(h.run(input, actor, "00000000-0000-4000-8000-000000000999")).rejects.toMatchObject({ status: 404 });
    await expect(h.run({ ...input, expectedRequestedAt: "2026-11-11T00:00:00.000Z" })).rejects.toMatchObject({ status: 409 });
    expect(h.tx.user.updateMany).not.toHaveBeenCalled();
  });
  it.each([{ ...input, confirm: false }, { ...input, reason: "短" }, { ...input, reason: "禁止换行\n原因" }, { ...input, unexpected: true }, { ...input, expectedUserId: "bad" }])("rejects invalid confirmation fields", async body => {
    const h = harness(); await expect(h.run(body)).rejects.toMatchObject({ status: 400 });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("requires a current super-admin role even when called outside the controller", async () => {
    const h = harness(); await expect(h.run(input, { id: "test-admin", role: "CUSTOMER_SERVICE" })).rejects.toMatchObject({ status: 403 });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
