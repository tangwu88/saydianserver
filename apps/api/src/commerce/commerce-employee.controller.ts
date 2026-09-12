import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UserAuthGuard } from "../common/user-auth.guard";
import {
  CurrentEmployee,
  CurrentUser,
  type AuthenticatedEmployee,
  type AuthenticatedUser,
} from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { safeObject } from "../common/crypto";
import { EmployeeAuthGuard } from "./employee-auth.guard";
import { EmployeePromotionService } from "./employee-promotion.service";
import type { EmployeeDashboardQuery } from "./employee-dashboard-query";
import { CommerceWithdrawalService } from "./commerce-withdrawal.service";

@ApiTags("commerce-employee-compatibility")
@Controller("api/saidian-mall/v1")
@RawResponse()
export class CommerceEmployeeController {
  constructor(
    private readonly employees: EmployeePromotionService,
    private readonly withdrawals: CommerceWithdrawalService,
  ) {}

  @Get("wecom/authorize-url")
  authorizeUrl(@Query("redirectUri") redirectUri: string) {
    return this.employees.authorizeUrl(redirectUri);
  }

  @Post("wecom/oauth")
  oauth(@Body() input: unknown) {
    return this.employees.oauth(String(safeObject(input).code ?? ""));
  }

  @Get("wecom/me/dashboard")
  @UseGuards(EmployeeAuthGuard)
  dashboard(
    @CurrentEmployee() employee: AuthenticatedEmployee,
    @Query() query: EmployeeDashboardQuery,
  ) {
    return this.employees.dashboard(employee.id, query);
  }

  @Get("wecom/me/promotion")
  @UseGuards(EmployeeAuthGuard)
  promotion(
    @CurrentEmployee() employee: AuthenticatedEmployee,
    @Query("productId") productId?: string,
  ) {
    return this.employees.promotion(employee.id, productId);
  }

  @Get("wecom/me/coupons")
  @UseGuards(EmployeeAuthGuard)
  coupons(@CurrentEmployee() employee: AuthenticatedEmployee) {
    return this.employees.employeeCoupons(employee.id);
  }

  @Post("wecom/me/coupons/:id/claim")
  @UseGuards(EmployeeAuthGuard)
  claimCoupons(
    @CurrentEmployee() employee: AuthenticatedEmployee,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.employees.claimCoupons(
      employee.id,
      id,
      safeObject(input).quantity,
    );
  }

  @Get("storefront/promoter/dashboard")
  @UseGuards(UserAuthGuard)
  async memberDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeDashboardQuery,
  ) {
    const promoter = await this.employees.memberPromoter(user.id);
    return this.employees.dashboard(promoter.id, query);
  }

  @Get("storefront/promoter/promotion")
  @UseGuards(UserAuthGuard)
  async memberPromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Query("productId") productId?: string,
  ) {
    const promoter = await this.employees.memberPromoter(user.id);
    return this.employees.promotion(promoter.id, productId);
  }

  @Get("storefront/promoter/coupons")
  @UseGuards(UserAuthGuard)
  async memberCoupons(@CurrentUser() user: AuthenticatedUser) {
    const promoter = await this.employees.memberPromoter(user.id);
    return this.employees.employeeCoupons(promoter.id);
  }

  @Post("storefront/promoter/coupons/:id/claim")
  @UseGuards(UserAuthGuard)
  async memberClaimCoupons(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const promoter = await this.employees.memberPromoter(user.id);
    return this.employees.claimCoupons(
      promoter.id,
      id,
      safeObject(input).quantity,
    );
  }

  @Get("storefront/promoter/withdrawals")
  @UseGuards(UserAuthGuard)
  async memberWithdrawals(@CurrentUser() user: AuthenticatedUser) {
    const promoter = await this.employees.memberPromoter(user.id);
    return this.withdrawals.employeeSummary(promoter.id);
  }

  @Post("storefront/promoter/withdrawals")
  @UseGuards(UserAuthGuard)
  async memberApplyWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const promoter = await this.employees.memberPromoter(user.id);
    return this.withdrawals.apply(promoter.id, input);
  }

  @Get("storefront/coupon-gifts/:token")
  gift(@Param("token") token: string) {
    return this.employees.gift(token);
  }

  @Post("storefront/coupon-gifts/:token/claim")
  @UseGuards(UserAuthGuard)
  redeemGift(
    @CurrentUser() user: AuthenticatedUser,
    @Param("token") token: string,
  ) {
    return this.employees.redeemGift(user.id, token);
  }
}
