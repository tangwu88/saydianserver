import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AdminRole } from "@prisma/client";
import { Throttle } from "@nestjs/throttler";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { CurrentAdmin, RequestWithContext } from "../common/request-context";
import { GiftNoStoreInterceptor } from "./gift.controller";
import { GiftQueryService } from "./gift-query.service";

const token = (request: RequestWithContext) =>
  /^Bearer ([A-Za-z0-9_-]{64})$/i.exec(
    request.header("authorization") || "",
  )?.[1];
const context = (request: RequestWithContext) => ({
  ip: request.ip,
  requestId: request.requestId,
});

@Injectable()
export class GiftQueryAuthGuard implements CanActivate {
  constructor(private readonly queries: GiftQueryService) {}
  async canActivate(execution: ExecutionContext) {
    const http = execution.switchToHttp();
    http.getResponse().setHeader("Cache-Control", "no-store, private");
    await this.queries.me(token(http.getRequest<RequestWithContext>()));
    return true;
  }
}

@Controller("api/saydian-app/gift-query/v1")
@UseInterceptors(GiftNoStoreInterceptor)
export class GiftQueryController {
  constructor(private readonly queries: GiftQueryService) {}
  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: unknown, @Req() request: RequestWithContext) {
    return this.queries.login(body, context(request));
  }
  @Get("me")
  @UseGuards(GiftQueryAuthGuard)
  me(@Req() request: RequestWithContext) {
    return this.queries.me(token(request));
  }
  @Post("logout")
  @UseGuards(GiftQueryAuthGuard)
  logout(@Req() request: RequestWithContext) {
    return this.queries.logout(token(request));
  }
  @Post("query")
  @UseGuards(GiftQueryAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  query(@Body() body: unknown, @Req() request: RequestWithContext) {
    return this.queries.query(token(request), body, context(request));
  }
}

@Controller("api/saydian-app/admin/v1")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN)
@UseInterceptors(GiftNoStoreInterceptor)
export class GiftQueryAdminController {
  constructor(private readonly queries: GiftQueryService) {}
  @Get("commerce-gift-query-accounts")
  accounts() {
    return this.queries.accounts();
  }
  @Post("commerce-gift-query-accounts")
  create(
    @CurrentAdmin() admin: { id: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.queries.saveAccount(
      admin.id,
      undefined,
      body,
      context(request),
    );
  }
  @Put("commerce-gift-query-accounts/:id")
  update(
    @CurrentAdmin() admin: { id: string },
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.queries.saveAccount(admin.id, id, body, context(request));
  }
  @Get("commerce-gift-query-logs")
  logs(@Query() query: Record<string, string>) {
    return this.queries.logs(query);
  }
}
