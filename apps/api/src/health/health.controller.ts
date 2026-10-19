import type { Response } from "express";
import { RawResponse } from "../common/raw-response.decorator";
import { SupportService } from "../support/support.service";
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Post,
  Query,
  Param,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { HealthMetric } from "@saydian/app-contracts";
import { HealthService } from "./health.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";

@ApiTags("health")
@Controller("api/saydian-app/v2/health")
@UseGuards(UserAuthGuard)
export class HealthController {
  constructor(private readonly health: HealthService, private readonly support: SupportService) {}

  @Get("records/:recordId/ecg")
  @RawResponse()
  async ecg(@CurrentUser() user: AuthenticatedUser,
    @Param("recordId") recordId: string, @Res() response: Response) {
    const file = await this.support.privateEcgArtifact(user.id, recordId);
    response.setHeader("content-type", "application/gzip");
    response.setHeader("content-length", String(file.byteSize));
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-sha256", file.sha256);
    response.setHeader("x-ecg-sample-rate", String(file.sampleRateHz));
    response.setHeader("x-ecg-sample-count", String(file.sampleCount));
    file.body.once("error", () => response.destroy());
    file.body.pipe(response);
  }

  @Get("capabilities")
  capabilities() {
    return {
      dailySummaryVersions: true,
      dailySummaryVersion: 1,
    };
  }

  @Post("records/batch")
  ingestBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.health.ingestBatch(user.id, idempotencyKey?.trim() ?? "", body);
  }

  @Get("records")
  @Header("Cache-Control", "no-store")
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("metric") metric?: string,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
    @Query("product") product?: string,
    @Query("platform") platform?: string,
  ) {
    if (product !== "saydian-app-cn" && (product !== "say-ring" || platform !== "ios"))
      return this.health.list(user.id, metric, Number(limit ?? 50), before);
    // Caller-declared scope, not trusted application identity. Ownership still
    // comes from UserAuthGuard. Filter in SQL before pagination, never in memory.
    const { metrics } = product === "saydian-app-cn" ? await this.support.cnReadOnlyHealth() : await this.support.sayRingIosReadOnlyHealth();
    const allowed: HealthMetric[] = ["sleep", "steps", "distance", "calories"];
    if (metrics.heart_rate) allowed.push("heart_rate");
    if (metrics.hrv) allowed.push("hrv");
    if (metrics.blood_oxygen) allowed.push("blood_oxygen");
    if (metrics.body_temperature) allowed.push("temperature");
    // Stress has no existing cloud metric; its local display flag adds no API.
    return this.health.list(user.id, metric, Number(limit ?? 50), before, allowed);
  }

  @Get("warning-rules")
  warningRules(@CurrentUser() user: AuthenticatedUser) {
    return this.health.warningRules(user.id);
  }

  @Get("warnings")
  warnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query("limit") limit?: string,
  ) {
    return this.health.warnings(user.id, Number(limit ?? 50));
  }

  @Post("warning-rules")
  saveWarningRules(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.health.saveWarningRules(user.id, body);
  }
}
