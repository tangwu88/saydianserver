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
});
