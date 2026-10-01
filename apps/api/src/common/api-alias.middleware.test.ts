import { afterEach, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { apiAlias } from "./api-alias.middleware";
import { MaintenanceMiddleware } from "./maintenance.middleware";
import type { RequestWithContext } from "./request-context";

afterEach(() => vi.unstubAllEnvs());
function alias(url: string, method = "POST") {
  const request = { url, originalUrl: url, method, body: { code: "synthetic" } } as Request;
  const next = vi.fn();
  apiAlias(request, {} as Response, next);
  expect(next).toHaveBeenCalledOnce();
  return request;
}
it("internally aliases paths and queries without changing method, body or redirecting", () => {
  const request = alias("/global/api/saydian-app/v2/auth/login?locale=en");
  expect(request.url).toBe("/api/saydian-app/v2/auth/login?locale=en");
  expect(request.originalUrl).toBe(request.url);
  expect(request.method).toBe("POST");
  expect(request.body).toEqual({ code: "synthetic" });
  expect(alias("/global/health", "GET").url).toBe("/health/ready");
  expect(alias("/global/health/ready", "GET").url).toBe("/health/ready");
  expect(alias("/unrelated/global/api/login").url).toBe("/unrelated/global/api/login");
});
it("preserves the legacy download product but never overwrites an explicit product", () => {
  const path = "/global/api/saydian-app/v2/support/app-update";
  expect(alias(path, "GET").url).toBe("/api/saydian-app/v2/support/app-update?product=saydian-global");
  expect(alias(path + "?product=say-ring", "GET").url).toBe("/api/saydian-app/v2/support/app-update?product=say-ring");
});
it("applies the identical write freeze to both prefixes without query-based exemptions", () => {
  vi.stubEnv("BUSINESS_WRITES_PAUSED", "true");
  for (const prefix of ["", "/global"]) {
    const request = alias(prefix + "/api/saydian-app/v2/devices?next=/api/saydian-app/admin/v1/auth/login");
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    new MaintenanceMiddleware().use(request as RequestWithContext, response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  }
});
