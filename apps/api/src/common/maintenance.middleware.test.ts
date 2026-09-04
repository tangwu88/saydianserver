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

  afterEach(() => {
    if (previous === undefined) delete process.env.MAINTENANCE_READ_ONLY;
    else process.env.MAINTENANCE_READ_ONLY = previous;
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
});
