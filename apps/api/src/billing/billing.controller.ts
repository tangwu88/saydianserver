import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import type { Request, Response } from "express";
import { AdminAuditInterceptor } from "../admin/admin-audit.interceptor";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { UserAuthGuard } from "../common/user-auth.guard";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { safeObject } from "../common/crypto";
import { BillingService } from "./billing.service";

type RequestWithRawBody = Request & { rawBody?: Buffer };

@ApiTags("billing")
@Controller("api/saydian-app/v2/billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("offers")
  offers(@Query("platform") platform?: string) {
    return this.billing.offers(platform);
  }

  @Post("payments/wechat/refund-notify")
  @HttpCode(200)
  @RawResponse()
  async wechatRefundNotify(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
    @Req() request: RequestWithRawBody,
  ) {
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(body));
    return this.billing.handleWechatRefundNotification(headers, body, rawBody);
  }

  @Get("entitlements")
  @UseGuards(UserAuthGuard)
  entitlements(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.entitlements(user.id);
  }

  @Post("payments")
  @UseGuards(UserAuthGuard)
  createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.billing.createPayment(user.id, body, {
      ...(request.ip ? { clientIp: request.ip } : {}),
    });
  }

  @Get("payments/:id")
  @UseGuards(UserAuthGuard)
  payment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.billing.payment(user.id, id);
  }

  @Post("apple/transactions/verify")
  @UseGuards(UserAuthGuard)
  verifyApple(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.billing.verifyAppleTransaction(user.id, body);
  }

  @Post("apple/notifications")
  @HttpCode(200)
  @RawResponse()
  appleNotification(@Body() body: unknown) {
    return this.billing.handleAppleNotification(body);
  }

  @Post("payments/wechat/notify")
  @HttpCode(200)
  @RawResponse()
  async wechatNotify(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
    @Req() request: RequestWithRawBody,
  ) {
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(body));
    return this.billing.handleWechatNotification(headers, body, rawBody);
  }

  @Post("payments/alipay/notify")
  @HttpCode(200)
  @RawResponse()
  async alipayNotify(
    @Body() body: Record<string, string>,
    @Res() response: Response,
  ) {
    const result = await this.billing.handleAlipayNotification(
      Object.fromEntries(
        Object.entries(safeObject(body)).map(([key, value]) => [key, String(value)]),
      ),
    );
    response.type("text/plain").send(result);
  }
}

@ApiTags("admin-billing")
@Controller("api/saydian-app/admin/v1")
@UseGuards(AdminAuthGuard)
@UseInterceptors(AdminAuditInterceptor)
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  @Post("provider-events/replay")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  replayProviderEvents(@Body() body: unknown) {
    return this.billing.replayVerifiedProviderEvents(body);
  }

  @Post("commerce-after-sales/:id/refund")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  refundAfterSale(@Param("id") id: string, @Body() body: unknown) {
    return this.billing.refundAfterSale(id, body);
  }

  @Post("payments/:id/refunds")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  createRefund(@Param("id") id: string, @Body() body: unknown) {
    return this.billing.createRefund(id, body);
  }
}
