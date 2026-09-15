import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceCompatibilityController } from "./commerce-compat.controller";

function fixture() {
  const auth = {
    requestSmsCode: vi.fn().mockResolvedValue({ expiresIn: 300 }),
    loginWithSms: vi.fn().mockResolvedValue({ token: "synthetic-session" }),
  };
  const globalAuth = {
    requestLoginCode: vi.fn().mockResolvedValue({ challengeId: "synthetic-challenge" }),
    loginWithCode: vi.fn().mockResolvedValue({ token: "synthetic-global-session" }),
  };
  const controller = new CommerceCompatibilityController(
    auth as any,
    {} as any,
    {} as any,
    {} as any,
    globalAuth as any,
    {} as any,
    {} as any,
  );
  return { controller, auth, globalAuth };
}

describe("unified storefront verification login routing", () => {
  beforeEach(() => vi.stubEnv("APP_REALM", "domestic"));
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured domestic SMS adapter for phone codes and login", async () => {
    const h = fixture();
    await expect(h.controller.requestLoginCode({ channel: "sms", identifier: "13800138000" })).resolves.toMatchObject({ configured: true, channel: "sms", retryAfter: 60 });
    expect(h.auth.requestSmsCode).toHaveBeenCalledWith("13800138000", "login");
    await h.controller.loginCode({ channel: "sms", identifier: "13800138000", code: "123456", consentVersion: "commerce-legal-v1", referralCode: "REF" });
    expect(h.auth.loginWithSms).toHaveBeenCalledWith({ mobile: "13800138000", code: "123456", consentVersion: "commerce-legal-v1", consentSource: "commerce_code", referralCode: "REF" });
    expect(h.globalAuth.requestLoginCode).not.toHaveBeenCalled();
  });

  it("routes domestic email and every global channel through one-time challenges", async () => {
    const domestic = fixture();
    await domestic.controller.requestLoginCode({ channel: "email", identifier: "member@example.com" });
    await domestic.controller.loginCode({ channel: "email", identifier: "member@example.com", challengeId: "synthetic-challenge", code: "123456" });
    expect(domestic.globalAuth.requestLoginCode).toHaveBeenCalledOnce();
    expect(domestic.globalAuth.loginWithCode).toHaveBeenCalledOnce();

    vi.stubEnv("APP_REALM", "global");
    const global = fixture();
    await global.controller.requestLoginCode({ channel: "sms", identifier: "+12025550123" });
    await global.controller.loginCode({ channel: "sms", identifier: "+12025550123", challengeId: "synthetic-challenge", code: "123456" });
    expect(global.globalAuth.requestLoginCode).toHaveBeenCalledOnce();
    expect(global.globalAuth.loginWithCode).toHaveBeenCalledOnce();
    expect(global.auth.requestSmsCode).not.toHaveBeenCalled();
  });
});
