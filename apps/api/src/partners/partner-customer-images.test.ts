import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { SupportService } from "../support/support.service";
import { PartnerAdminController } from "./partner-admin.controller";

function harness() {
  const partnerId = randomUUID(),
    fileId = randomUUID();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWNYffb96rPvGSAUAEJCCZ0WY1CJAAAAAElFTkSuQmCC",
    "base64",
  );
  const file = {
    originalname: "synthetic.png",
    buffer: bytes,
    size: bytes.length,
    mimetype: "image/png",
  } as Express.Multer.File;
  const db: any = {
    brandPartner: { findUnique: vi.fn(async () => ({ id: partnerId })) },
    fileObject: {
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({ id: fileId })),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  db.$transaction = (fn: any) =>
    typeof fn === "function" ? fn(db) : Promise.all(fn);
  const service = new SupportService(db, {} as any);
  const send = vi.fn(async () => ({ Body: Readable.from([bytes]) }));
  vi.spyOn(service as any, "storage").mockResolvedValue({
    s3: { send },
    bucket: "synthetic",
  });
  return { service, db, send, file, partnerId, fileId };
}
describe("private customer images for partners", () => {
  it("rejects the partner limit before writing another object", async () => {
    const h = harness();
    h.db.fileObject.count.mockResolvedValue(200);
    await expect(
      h.service.uploadPartnerCustomerImage(
        "admin",
        h.partnerId,
        h.file,
        "request",
      ),
    ).rejects.toThrow("最多保存200张");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("saves a validated image under its partner and audits only its ID", async () => {
    const h = harness();
    await h.service.uploadPartnerCustomerImage(
      "admin",
      h.partnerId,
      h.file,
      "request",
    );
    expect(h.db.fileObject.create.mock.calls[0][0].data.purpose).toBe(
      `partner-customer:${h.partnerId}`,
    );
    expect(h.db.fileObject.create.mock.calls[0][0].data.objectKey).toContain(
      `partner-customer/${h.partnerId}/`,
    );
    expect(h.db.auditLog.create.mock.calls[0][0].data.afterJson).toEqual({
      fileId: h.fileId,
    });
  });
  it("refuses a disguised HTML upload before writing storage", async () => {
    const h = harness();
    h.file.buffer = Buffer.from("<html>synthetic unsafe file</html>");
    h.file.size = h.file.buffer.length;
    await expect(
      h.service.uploadPartnerCustomerImage(
        "admin",
        h.partnerId,
        h.file,
        "request",
      ),
    ).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("does not read an image using another partner's ID", async () => {
    const h = harness();
    h.db.fileObject.findFirst.mockResolvedValue(null);
    await expect(
      h.service.partnerCustomerImage("admin", h.partnerId, h.fileId, "request"),
    ).rejects.toThrow("不存在");
    expect(h.db.fileObject.findFirst).toHaveBeenCalledWith({
      where: {
        id: h.fileId,
        purpose: `partner-customer:${h.partnerId}`,
        status: "ACTIVE",
      },
    });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("cannot expose customer documents using the public files endpoint", async () => {
    const h = harness();
    h.db.fileObject.findUnique.mockResolvedValue({
      purpose: `partner-customer:${h.partnerId}`,
      status: "ACTIVE",
    });
    await expect(h.service.publicFile(h.fileId)).rejects.toThrow("不存在");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("fails closed if the private read audit cannot be stored", async () => {
    const h = harness();
    h.db.fileObject.findFirst.mockResolvedValue({
      contentType: "image/png",
      objectKey: "private",
      byteSize: 10,
    });
    h.db.auditLog.create.mockRejectedValue(
      new Error("synthetic audit failure"),
    );
    await expect(
      h.service.partnerCustomerImage("admin", h.partnerId, h.fileId, "request"),
    ).rejects.toThrow("audit failure");
    expect(h.send).not.toHaveBeenCalled();
  });
  it("requires SUPER_ADMIN for list, upload and private preview", () => {
    for (const method of [
      "customerImages",
      "uploadCustomerImage",
      "customerImage",
    ] as const)
      expect(
        Reflect.getMetadata(
          "saydian.admin-roles",
          PartnerAdminController.prototype[method],
        ),
      ).toEqual(["SUPER_ADMIN"]);
  });
});
