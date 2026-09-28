import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import type { AuthenticatedUser } from "../common/request-context";

describe("daily summary HTTP contract", () => {
  it("exposes capabilities on the authenticated health route", () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe("api/saydian-app/v2/health");
    expect(Reflect.getMetadata(GUARDS_METADATA, HealthController)).toContain(UserAuthGuard);
    expect(Reflect.getMetadata(PATH_METADATA, HealthController.prototype.capabilities)).toBe("capabilities");
    expect(Reflect.getMetadata(METHOD_METADATA, HealthController.prototype.capabilities)).toBe(RequestMethod.GET);
    expect(new HealthController({} as HealthService).capabilities()).toEqual({ dailySummaryVersions: true });
  });

  it.each([undefined, "false", "1", "TRUE"])("keeps old clients outside daily summaries for %s", (include) => {
    const list = vi.fn();
    const controller = new HealthController({ list } as unknown as HealthService);
    const user = { id: "synthetic-member" } as AuthenticatedUser;
    controller.list(user, "steps", "25", undefined, include);
    expect(list).toHaveBeenCalledWith(user.id, "steps", 25, undefined, false);
  });

  it("passes explicit opt-in, member identity and cursor to the folded query", () => {
    const list = vi.fn();
    const controller = new HealthController({ list } as unknown as HealthService);
    const user = { id: "synthetic-member" } as AuthenticatedUser;
    controller.list(user, "sleep", "10", "synthetic-cursor", "true");
    expect(list).toHaveBeenCalledWith(user.id, "sleep", 10, "synthetic-cursor", true);
  });
});
