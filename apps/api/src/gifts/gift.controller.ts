import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Param,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AdminRole } from "@prisma/client";
import type { Response } from "express";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import {
  CurrentAdmin,
  CurrentUser,
  RequestWithContext,
} from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { UserAuthGuard } from "../common/user-auth.guard";
import { GiftService } from "./gift.service";
const context = (request: RequestWithContext) => ({
  ip: request.ip,
  requestId: request.requestId,
});
@Injectable()
export class GiftNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    return next.handle();
  }
}

@ApiTags("commerce-gift-redemption")
@Controller("api/saidian-mall/v1/storefront/gift-redemptions")
@RawResponse()
@UseInterceptors(GiftNoStoreInterceptor)
export class GiftController {
  constructor(private readonly gifts: GiftService) {}
  @Get("capabilities")
  capabilities() {
    return this.gifts.capabilities();
  }
  @Post("validate")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  validate(
    @Body() body: unknown,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return this.gifts.validate(body, context(request));
  }
  @Post("session")
  view(
    @Body() body: { token?: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return this.gifts.view(body?.token);
  }
  @Post("sms/request")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  sms(@Body() body: unknown, @Req() request: RequestWithContext) {
    return this.gifts.requestSms(body, context(request));
  }
  @Post("sms/verify")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(
    @Body() body: unknown,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return this.gifts.verifySms(body, context(request));
  }
  @Post("preview")
  @UseGuards(UserAuthGuard)
  preview(
    @CurrentUser() user: { id: string; sessionId: string },
    @Body() body: unknown,
  ) {
    return this.gifts.preview(user, body);
  }
  @Post("submit")
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(
    @CurrentUser() user: { id: string; sessionId: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.gifts.redeem(user, body, context(request));
  }
  @Post("result")
  @UseGuards(UserAuthGuard)
  result(
    @CurrentUser() user: { id: string; sessionId: string },
    @Body() body: unknown,
  ) {
    return this.gifts.result(user, body);
  }
}

@ApiTags("admin-commerce-gifts")
@Controller("api/saydian-app/admin/v1")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
@UseInterceptors(GiftNoStoreInterceptor)
export class GiftAdminController {
  constructor(private readonly gifts: GiftService) {}
  @Get("commerce-gift-batches")
  batches(@Query() query: Record<string, string>) {
    return this.gifts.batches(query);
  }
  @Get("commerce-gift-cards")
  cards(@Query() query: Record<string, string>) {
    return this.gifts.cards(query);
  }
  @Get("commerce-gift-redemptions")
  records(@Query() query: Record<string, string>) {
    return this.gifts.records(query);
  }
  @Get("commerce-gift-products")
  products() {
    return this.gifts.products();
  }
  @Get("commerce-gift-settings")
  settings() {
    return this.gifts.capabilities();
  }
  @Get("commerce-gift-cards/:id/qr")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  qr(@Param("id") id: string) {
    return this.gifts.qr(id);
  }
  @Post("commerce-gift-batches")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  generate(
    @CurrentAdmin() admin: { id: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    return this.gifts.generate(admin.id, body, context(request));
  }
  @Post("commerce-gift-cards/actions")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  change(
    @CurrentAdmin() admin: { id: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.gifts.change(admin.id, body, context(request));
  }
  @Put("commerce-gift-settings")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  configure(
    @CurrentAdmin() admin: { id: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.gifts.settings(admin.id, body, context(request));
  }
}
