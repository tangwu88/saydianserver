import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminRole } from "@prisma/client";
import { ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { CurrentAdmin, CurrentEmployee, type AuthenticatedEmployee } from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { EmployeeAuthGuard } from "./employee-auth.guard";
import { CommerceWithdrawalService } from "./commerce-withdrawal.service";

@ApiTags("commerce-employee-withdrawals")
@Controller("api/saidian-mall/v1/wecom/me/withdrawals")
@RawResponse()
@UseGuards(EmployeeAuthGuard)
export class CommerceEmployeeWithdrawalController {
  constructor(private readonly withdrawals: CommerceWithdrawalService) {}
  @Get() summary(@CurrentEmployee() employee: AuthenticatedEmployee) { return this.withdrawals.employeeSummary(employee.id); }
  @Post() apply(@CurrentEmployee() employee: AuthenticatedEmployee, @Body() input: unknown) { return this.withdrawals.apply(employee.id, input); }
}

@ApiTags("admin-commerce-withdrawals")
@Controller("api/saydian-app/admin/v1/commerce/withdrawals")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
export class CommerceAdminWithdrawalController {
  constructor(private readonly withdrawals: CommerceWithdrawalService) {}
  @Get() list(@Query() input: unknown) { return this.withdrawals.adminList(input); }
  @Post(":id/review") review(@CurrentAdmin() admin: { id: string }, @Param("id") id: string, @Body() input: unknown) { return this.withdrawals.review(id, admin.id, input); }
  @Post(":id/manual-receipt") receipt(@CurrentAdmin() admin: { id: string }, @Param("id") id: string, @Body() input: unknown) { return this.withdrawals.recordManualReceipt(id, admin.id, input); }
  @Post(":id/verify-original-transfer") verify(@CurrentAdmin() admin: { id: string }, @Param("id") id: string, @Body() input: unknown) { return this.withdrawals.verifyLegacyResult(id, admin.id, input); }
}
