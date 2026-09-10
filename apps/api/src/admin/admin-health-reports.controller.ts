import { Body, Controller, Get, Post, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AdminRole } from "@prisma/client";
import { ApiTags } from "@nestjs/swagger";
import { CurrentAdmin, type RequestWithContext } from "../common/request-context";
import { AdminAuthGuard, AdminRoles } from "./admin-auth";
import { AdminHealthReportsService } from "./admin-health-reports.service";

@ApiTags("admin-health-reports")
@Controller("api/saydian-app/admin/v1/health-reports")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.HEALTH_AUDITOR)
export class AdminHealthReportsController {
  constructor(private readonly reports: AdminHealthReportsService) {}

  @Get("availability")
  availability(@Query("memberId") memberId: string, @CurrentAdmin() current: { id: string; role: string; roles?: string[] }) {
    return this.reports.availability(memberId, current);
  }

  @Post()
  create(@Body() input: unknown, @CurrentAdmin() current: { id: string; role: string; roles?: string[] }, @Req() request: RequestWithContext) {
    return this.reports.create(input, current, request.requestId);
  }

  @Get(":id")
  detail(@Param("id") id: string, @CurrentAdmin() current: { id: string; role: string; roles?: string[] }, @Req() request: RequestWithContext) {
    return this.reports.detail(id, current, request.requestId);
  }
}
