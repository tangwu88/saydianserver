import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { UserAuthGuard } from "../common/user-auth.guard";
import { HealthController } from "./health.controller";

describe("global V2 health daily summary capability", () => {
  it("is an authenticated GET at the canonical health path", () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe(
      "api/saydian-app/v2/health",
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        HealthController.prototype.capabilities,
      ),
    ).toBe("capabilities");
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        HealthController.prototype.capabilities,
      ),
    ).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(GUARDS_METADATA, HealthController)).toContain(
      UserAuthGuard,
    );
  });

  it("advertises the exact contract consumed by the international App", () => {
    const controller = new HealthController({} as never);
    expect(controller.capabilities()).toEqual({
      dailySummaryVersions: true,
      dailySummaryVersion: 1,
    });
  });
});
