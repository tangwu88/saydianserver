import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import { CurrentAdmin, RequestWithContext } from "../common/request-context";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { PartnerAdminService } from "./partner-admin.service";

type Admin = { id: string };
@ApiTags("admin-brand-partner")
@Controller("api/saydian-app/admin/v1")
@UseGuards(AdminAuthGuard)
export class PartnerAdminController {
  constructor(private readonly admin: PartnerAdminService) {}

  @Get("partners")
  list(@Query("search") search = "", @Query("page") page?: string) {
    return this.admin.list(search, page);
  }
  @Post("partners")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  create(
    @CurrentAdmin() actor: Admin,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.create(actor.id, body, request.requestId);
  }
  @Patch("partners/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  update(
    @CurrentAdmin() actor: Admin,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.update(actor.id, id, body, request.requestId);
  }
  @Post("partners/:id/reset-password")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  resetPassword(
    @CurrentAdmin() actor: Admin,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.resetPassword(actor.id, id, body, request.requestId);
  }
  @Get("partners/:id/promotion")
  promotion(@Param("id") id: string) {
    return this.admin.promotion(id);
  }
  @Post("partners/members/:id/assignment")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  assignment(
    @CurrentAdmin() actor: Admin,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.assignMember(actor.id, id, body, request.requestId);
  }
  @Get("partner-levels")
  levels() {
    return this.admin.levels();
  }
  @Post("partner-levels")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  createLevel(
    @CurrentAdmin() actor: Admin,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.saveLevel(actor.id, null, body, request.requestId);
  }
  @Patch("partner-levels/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  updateLevel(
    @CurrentAdmin() actor: Admin,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.saveLevel(actor.id, id, body, request.requestId);
  }
  @Get("partner-prices")
  prices(
    @Query("levelId") levelId: string,
    @Query("search") search = "",
    @Query("page") page?: string,
  ) {
    return this.admin.prices(levelId, search, page);
  }
  @Patch("partner-prices/:levelId/:skuId")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  savePrice(
    @CurrentAdmin() actor: Admin,
    @Param("levelId") levelId: string,
    @Param("skuId") skuId: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.savePrice(
      actor.id,
      levelId,
      skuId,
      body,
      request.requestId,
    );
  }
  @Get("partner-finance/:id/wallet")
  wallet(@Param("id") id: string) {
    return this.admin.wallet(id);
  }
  @Get("partner-finance/:id/ledger")
  ledger(
    @Param("id") id: string,
    @Query("account") account = "",
    @Query("page") page?: string,
  ) {
    return this.admin.ledger(id, account, page);
  }
  @Get("partner-finance/:id/recharges")
  recharges(@Param("id") id: string, @Query("page") page?: string) {
    return this.admin.recharges(id, page);
  }
  @Post("partner-finance/:id/deposit")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  deposit(
    @CurrentAdmin() actor: Admin,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.deposit(actor.id, id, body, request.requestId);
  }
}
