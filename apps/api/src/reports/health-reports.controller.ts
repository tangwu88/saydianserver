import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RawResponse } from "../common/raw-response.decorator";
import { UserAuthGuard } from "../common/user-auth.guard";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../common/request-context";
import { HealthReportsService } from "./health-reports.service";

@ApiTags("health-reports")
@Controller("api/saydian-app/v2/health")
@UseGuards(UserAuthGuard)
export class HealthReportsController {
  constructor(private readonly reports: HealthReportsService) {}

  @Get("profile")
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.profile(user.id);
  }

  @Post("profile/analysis-consent")
  setAnalysisConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.reports.setAnalysisConsent(user.id, body);
  }

  @Get("reports/eligibility")
  eligibility(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.eligibility(user.id);
  }

  @Get("reports")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.list(user.id);
  }

  @Post("reports")
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.create(user.id);
  }

  @Get("reports/:id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.reports.get(user.id, id);
  }

  @Get("reports/:id/full")
  full(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.reports.full(user.id, id);
  }

  @Get("reports/:id/export")
  @RawResponse()
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const pdf = await this.reports.exportPdf(user.id, id);
    response.set({
      "content-type": "application/pdf",
      "content-length": String(pdf.byteLength),
      "content-disposition": `attachment; filename="saydian-health-report-${id}.pdf"`,
      "cache-control": "private, no-store",
    });
    response.send(pdf);
  }

  @Post("reports/:id/retry")
  retry(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.reports.retry(user.id, id);
  }
}
