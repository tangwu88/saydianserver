import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalVerificationDeliveryService } from "./global-verification-delivery.service";
import { deliverWecomEmail } from "./wecom-email";
import { emailDeliverySettings } from "./email-delivery-settings";
import { AdminEmailDeliveryController } from "../admin/admin-email-delivery.controller";

const smtp = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.createTransport } }));
const config = { fromAddress: "sender@example.com", smtpPassword: "synthetic-client-secret" };
const input = { channel: "email" as const, identifier: "recipient@example.net", country: null, code: "123456", purpose: "login" as const, locale: "zh-Hans", challengeId: "synthetic-challenge" };

beforeEach(() => {
  vi.stubEnv("MAINTENANCE_READ_ONLY", "false");
  vi.stubEnv("WORKER_OUTBOUND_PAUSED", "false");
  vi.clearAllMocks();
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail, close: smtp.close });
  smtp.sendMail.mockResolvedValue({ accepted: ["recipient@example.net"], rejected: [] });
});
afterEach(() => vi.unstubAllEnvs());

function harness(verified = true, state = "CONFIGURED") {
  const row = { state, publicConfig: { provider: "wecom_smtp", fromAddress: config.fromAddress, deliveryVerified: verified } };
  const resolve = vi.fn().mockResolvedValue({ smtpPassword: config.smtpPassword });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const service = new GlobalVerificationDeliveryService({ integrationConfig: { findUnique: vi.fn().mockResolvedValue(row), updateMany } } as any, { resolve } as any, { aliyunReady: vi.fn().mockResolvedValue(false) } as any);
  return { row, resolve, updateMany, service };
}

describe("enterprise email delivery and readiness", () => {
  it("uses fixed TLS endpoint, one recipient and no file/URL access or SMTP logging", async () => {
    await deliverWecomEmail(config, { recipient: input.identifier, code: input.code });
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.exmail.qq.com", port: 465, secure: true, auth: { user: config.fromAddress, pass: config.smtpPassword }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, debug: false, logger: false, disableFileAccess: true, disableUrlAccess: true }));
    const sent = smtp.sendMail.mock.calls[0]![0];
    expect(sent.envelope).toEqual({ from: config.fromAddress, to: [input.identifier] });
    expect(sent.text).toContain("123456");
    expect(sent).not.toHaveProperty("attachments");
    expect(smtp.close).toHaveBeenCalledOnce();
  });

  it("does not send with injected headers, multiple recipients or malformed OTP", async () => {
    for (const recipient of ["a@example.net\r\nBcc: evil@example.net", "a@example.net,b@example.net", "broken"]) {
      await expect(deliverWecomEmail(config, { recipient, code: "123456" })).rejects.toThrow();
    }
    await expect(deliverWecomEmail(config, { recipient: input.identifier, code: "arbitrary body" })).rejects.toThrow();
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("keeps login closed before delivery acceptance but allows an explicit admin test", async () => {
    const h = harness(false);
    expect((await h.service.capabilities()).email).toBe(false);
    expect(h.resolve).not.toHaveBeenCalled();
    await expect(h.service.send(input)).rejects.toMatchObject({ status: 503 });
    await expect(h.service.sendEmailTest(input.identifier)).resolves.toEqual({ submitted: true, deliveryVerified: false });
    expect(smtp.sendMail.mock.calls[0]![0].subject).toContain("连接测试");
    expect(smtp.sendMail.mock.calls[0]![0].text).not.toContain("123456");
    expect(h.row.publicConfig.deliveryVerified).toBe(false);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect((await h.service.capabilities()).email).toBe(false);
  });

  it("never sends tests or OTP while paused or missing credentials", async () => {
    const paused = harness(true, "DISABLED");
    await expect(paused.service.sendEmailTest(input.identifier)).rejects.toThrow();
    expect(paused.resolve).not.toHaveBeenCalled();
    const missing = harness(); missing.resolve.mockResolvedValue({});
    expect((await missing.service.capabilities()).email).toBe(false);
    await expect(missing.service.send(input)).rejects.toThrow();
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("masks provider failure and rejection without marking success", async () => {
    for (const failure of ["throw", "reject"] as const) {
      const h = harness();
      if (failure === "throw") smtp.sendMail.mockRejectedValueOnce(new Error(`AUTH ${config.smtpPassword}`));
      else smtp.sendMail.mockResolvedValueOnce({ accepted: [], rejected: [input.identifier] });
      try { await h.service.send(input); throw new Error("expected failure"); }
      catch (error) { expect(String(error)).not.toContain(config.smtpPassword); expect(error).toMatchObject({ status: 503 }); }
      expect(h.updateMany).not.toHaveBeenCalled();
    }
    expect(smtp.close).toHaveBeenCalledTimes(2);
  });

  it("marks a successful real provider submission without returning OTP or credentials", async () => {
    const h = harness();
    await expect(h.service.send(input)).resolves.toBeUndefined();
    expect(h.updateMany).toHaveBeenCalledWith({ where: { key: "email_otp" }, data: { lastCheckedAt: expect.any(Date), lastError: null } });
  });

  it("does not treat the SMTP email provider as an SMS provider", async () => {
    const h = harness();
    expect((await h.service.capabilities()).sms).toBe(false);
    await expect(h.service.send({ ...input, channel: "sms", identifier: "+12025550123", country: "US" })).rejects.toThrow();
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("restricts the admin test endpoint to integration managers and super admins", () => {
    expect(Reflect.getMetadata("saydian.admin-roles", AdminEmailDeliveryController.prototype.test)).toEqual(["SUPER_ADMIN", "INTEGRATION_ADMIN"]);
  });
  it("keeps the explicit test behind maintenance and outbound pause switches", async () => {
    const h = harness(false);
    for (const key of ["MAINTENANCE_READ_ONLY", "WORKER_OUTBOUND_PAUSED"]) {
      vi.stubEnv(key, "true");
      await expect(h.service.sendEmailTest(input.identifier)).rejects.toThrow();
      vi.stubEnv(key, "false");
    }
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });
});

describe("email delivery acceptance reset", () => {
  const before = { provider: "wecom_smtp", fromAddress: config.fromAddress, deliveryVerified: true };
  it("preserves acceptance only for the same sender/provider and unchanged secret", () => {
    expect(emailDeliverySettings(before, before, false).deliveryVerified).toBe(true);
    expect(emailDeliverySettings(before, before, true).deliveryVerified).toBe(false);
    expect(emailDeliverySettings(before, { ...before, fromAddress: "new@example.com" }, false).deliveryVerified).toBe(false);
    expect(emailDeliverySettings(before, { provider: "webhook", deliveryVerified: true }, false).deliveryVerified).toBe(false);
    expect(emailDeliverySettings(null, before, false).deliveryVerified).toBe(false);
  });
  it("rejects a password in public settings and invalid sender", () => {
    expect(() => emailDeliverySettings(before, { ...before, smtpPassword: "synthetic-secret" }, false)).toThrow();
    expect(() => emailDeliverySettings(before, { ...before, fromAddress: "bad" }, false)).toThrow();
  });
});
