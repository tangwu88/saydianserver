import { describe, expect, it, vi } from "vitest";
import { Prisma, UserStatus } from "@prisma/client";
import { AccountDeletionWorker, anonymizedOrderData, anonymizedUserData } from "./account-deletion-worker";

describe("account deletion anonymization", () => {
  it("removes direct identifiers and remains deterministic for retries", () => {
    const first = anonymizedUserData("5b5e73ec-3353-4d5c-89bd-e9610c590cf2");
    const second = anonymizedUserData("5b5e73ec-3353-4d5c-89bd-e9610c590cf2");
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      mobile: null,
      mobileVerifiedAt: null,
      email: null,
      emailVerifiedAt: null,
      wechatUnionId: null,
      wechatOpenId: null,
      wechatAppOpenId: null,
      passwordHash: null,
      avatarUrl: null,
      status: UserStatus.DELETED,
      referralEmployeeId: null,
    });
    expect(first.nickname).not.toContain("5b5e73ec");
  });

  it("physically deletes only the claimed account files before completing anonymization", async () => {
    const userId = "5b5e73ec-3353-4d5c-89bd-e9610c590cf2";
    const file = { id: "file-one", objectKey: `avatar/${userId}/one.png` };
    const fileDeletion = { delete: vi.fn(async () => undefined) };
    const tx: any = new Proxy({
      fileObject: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      wechatOfficialIdentity: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      user: { update: vi.fn(async () => ({})) },
      accountDeletionRequest: { update: vi.fn(async () => ({})) },
    }, {
      get(target, key: string) {
        if (!(key in target)) (target as any)[key] = { deleteMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 0 })) };
        return (target as any)[key];
      },
    });
    const prisma: any = {
      accountDeletionRequest: {
        findFirst: vi.fn(async () => ({ id: "request-one", userId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
      },
      fileObject: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [file]),
      },
      $transaction: vi.fn(async (run: any) => run(tx)),
    };
    await expect(new AccountDeletionWorker(prisma, fileDeletion).runOnce()).resolves.toBe(true);
    expect(prisma.fileObject.updateMany).toHaveBeenCalledWith({ where: { ownerUserId: userId }, data: { status: "DELETION_PENDING" } });
    expect(prisma.fileObject.findMany).toHaveBeenCalledWith({ where: { ownerUserId: userId, status: "DELETION_PENDING" }, select: { id: true, objectKey: true }, orderBy: { id: "asc" } });
    expect(fileDeletion.delete).toHaveBeenCalledWith([file.objectKey]);
    expect(tx.fileObject.deleteMany).toHaveBeenCalledWith({ where: { ownerUserId: userId, status: "DELETION_PENDING", id: { in: [file.id] } } });
    expect(tx.wechatOfficialIdentity.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: userId }, data: expect.objectContaining({ email: null, wechatAppOpenId: null, avatarUrl: null, status: UserStatus.DELETED }) });
  });

  it("does not mark deletion complete when physical object deletion fails", async () => {
    const userId = "5b5e73ec-3353-4d5c-89bd-e9610c590cf2";
    const update = vi.fn(async () => ({}));
    const prisma: any = {
      accountDeletionRequest: {
        findFirst: vi.fn(async () => ({ id: "request-one", userId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update,
      },
      fileObject: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [{ id: "file-one", objectKey: `avatar/${userId}/one.png` }]),
      },
      $transaction: vi.fn(),
    };
    const fileDeletion = { delete: vi.fn(async () => { throw new Error("storage unavailable"); }) };
    await expect(new AccountDeletionWorker(prisma, fileDeletion).runOnce()).resolves.toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: "request-one" }, data: { status: "FAILED", failureReason: "storage unavailable" } });
  });

  it("removes delivery and invoice data while retaining the financial order row", () => {
    expect(anonymizedOrderData()).toEqual({
      recipientName: "已注销用户",
      recipientMobile: "",
      province: "",
      city: "",
      district: "",
      addressDetail: "",
      buyerRemark: null,
      invoiceJson: Prisma.DbNull,
    });
  });
});
