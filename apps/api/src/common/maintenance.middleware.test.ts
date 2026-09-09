import type { NextFunction, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestWithContext } from "./request-context";
import { MaintenanceMiddleware } from "./maintenance.middleware";

function request(path: string, originalUrl: string): RequestWithContext {
  return {
    method: "POST",
    path,
    url: path,
    originalUrl,
  } as RequestWithContext;
}

describe("MaintenanceMiddleware", () => {
  const previous = process.env.MAINTENANCE_READ_ONLY;
  const previousMemberAuth = process.env.MAINTENANCE_ALLOW_MEMBER_AUTH;
  const previousBusinessPause = process.env.BUSINESS_WRITES_PAUSED;

  afterEach(() => {
    if (previous === undefined) delete process.env.MAINTENANCE_READ_ONLY;
    else process.env.MAINTENANCE_READ_ONLY = previous;
    if (previousMemberAuth === undefined) delete process.env.MAINTENANCE_ALLOW_MEMBER_AUTH;
    else process.env.MAINTENANCE_ALLOW_MEMBER_AUTH = previousMemberAuth;
    if (previousBusinessPause === undefined) delete process.env.BUSINESS_WRITES_PAUSED;
    else process.env.BUSINESS_WRITES_PAUSED = previousBusinessPause;
  });

  it("allows admin login when the mounted path is trimmed", () => {
    process.env.MAINTENANCE_READ_ONLY = "true";
    const response = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    new MaintenanceMiddleware().use(
      request("/", "/api/saydian-app/admin/v1/auth/login"),
      response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("continues to reject ordinary writes during maintenance", () => {
    process.env.MAINTENANCE_READ_ONLY = "true";
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const response = { status } as unknown as Response;
    const next = vi.fn() as NextFunction;

    new MaintenanceMiddleware().use(
      request("/", "/api/saydian-app/v2/auth/login"),
      response,
      next,
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "系统维护中，请稍后再试" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    "/api/saydian-app/v2/auth/register?next=/admin/v1/auth/login",
    "/api/v1/member/member/save?next=/health/ready",
    "/unrelated/api/saydian-app/admin/v1/auth/login",
  ])("does not bypass maintenance through %s", (originalUrl) => {
    process.env.MAINTENANCE_READ_ONLY = "true";
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn() as NextFunction;
    new MaintenanceMiddleware().use(request("/", originalUrl), { status } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows the exact admin login with a trailing slash and query", () => {
    process.env.MAINTENANCE_READ_ONLY = "true";
    const next = vi.fn() as NextFunction;
    new MaintenanceMiddleware().use(
      request("/", "/api/saydian-app/admin/v1/auth/login/?source=admin"),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows verified callback receipt, but not similarly named callback paths", () => {
    process.env.MAINTENANCE_READ_ONLY = "true";
    const next = vi.fn();
    new MaintenanceMiddleware().use(request("/", "/api/saydian-app/v2/billing/payments/wechat/notify"), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    const status = vi.fn(() => ({ json: vi.fn() }));
    new MaintenanceMiddleware().use(request("/", "/unknown/payments/wechat/notify"), { status } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(503);
  });

  it("blocks the legacy GET that marks a notification read during a freeze", () => {
    process.env.BUSINESS_WRITES_PAUSED = "true";
    const status = vi.fn(() => ({ json: vi.fn() }));
    const next = vi.fn();
    const getRequest = { ...request("/", "/api/v1/member/notify/123"), method: "GET" } as RequestWithContext;
    new MaintenanceMiddleware().use(getRequest, { status } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("can explicitly allow member login for a read-only verification window without allowing registration", () => {
    process.env.MAINTENANCE_READ_ONLY = "true";
    process.env.MAINTENANCE_ALLOW_MEMBER_AUTH = "true";
    const next = vi.fn();
    new MaintenanceMiddleware().use(request("/", "/api/saydian-app/v2/auth/login"), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    const status = vi.fn(() => ({ json: vi.fn() }));
    new MaintenanceMiddleware().use(request("/", "/api/saydian-app/v2/auth/register"), { status } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(503);
  });
});
