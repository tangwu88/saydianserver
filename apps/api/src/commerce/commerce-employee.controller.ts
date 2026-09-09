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

@ApiTags("commerce-employee-compatibility")
@Controller("api/saidian-mall/v1")
@RawResponse()
export class CommerceEmployeeController {
  constructor(private readonly employees: EmployeePromotionService) {}

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
