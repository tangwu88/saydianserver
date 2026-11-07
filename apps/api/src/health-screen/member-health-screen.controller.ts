import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Header,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
  type RequestWithContext,
} from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { UserAuthGuard } from "../common/user-auth.guard";
import { MemberScreenLogin, MemberScreenGuard } from "./member-screen-login";
import { HealthScreenService } from "./health-screen.service";

@ApiTags("member-screen-login")
@Controller("api/saydian-app/v2/member-health-screen/login")
export class ScreenLoginController {
  constructor(private readonly login: MemberScreenLogin) {}
  @Get("options")
  @Header("Cache-Control", "no-store")
  async options() {
    return { enabled: await this.login.enabled() };
  }
  @Post("session")
  @UseGuards(UserAuthGuard)
  @Header("Cache-Control", "no-store")
  session(@CurrentUser() user: AuthenticatedUser) {
    return this.login.exchange(user);
  }
  @Post("qr")
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  qr() {
    return this.login.createQr();
  }
  @Post("qr/result")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  result(@Body("poll") poll: string) {
    return this.login.poll(poll);
  }
  @Post("qr/cancel")
  @Header("Cache-Control", "no-store")
  cancel(@Body("poll") poll: string) {
    return this.login.cancel(poll);
  }
}
@ApiTags("member-screen-login")
@RawResponse()
@Controller("api/saidian-mall/v1/auth/health-screen")
export class ScreenScanController {
  constructor(private readonly login: MemberScreenLogin) {}
  @Post("scan")
  @Header("Cache-Control", "no-store")
  scan(@Body("scan") scan: string) {
    return this.login.inspect(scan);
  }
  @Post("approve")
  @UseGuards(UserAuthGuard)
  @Header("Cache-Control", "no-store")
  approve(@Body("scan") scan: string, @CurrentUser() user: AuthenticatedUser) {
    return this.login.approve(scan, user);
  }
}
@ApiTags("member-health-screen-self")
@Controller("api/saydian-app/v2/member-health-screen/me")
@UseGuards(MemberScreenGuard)
export class OwnHealthScreenController {
  constructor(
    private readonly service: HealthScreenService,
    private readonly login: MemberScreenLogin,
  ) {}
  @Get("profile")
  @Header("Cache-Control", "no-store")
  profileGate(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.profileGate(user.id, actor, req.requestId);
  }
  @Post("profile")
  @Header("Cache-Control", "no-store")
  completeProfile(
    @Body() input: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.completeProfile(user.id, input, actor, req.requestId);
  }
  @Get("")
  @Header("Cache-Control", "no-store")
  load(
    @Query("days") days: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.load(user.id, days, actor, req.requestId);
  }
  @Get("updates")
  @Header("Cache-Control", "no-store")
  updates(
    @Query("days") days: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.updates(user.id, days, actor, req.requestId);
  }
  @Get("records")
  @Header("Cache-Control", "no-store")
  records(
    @Query() query: { days?: string; metric?: string; cursor?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.records(user.id, query, actor, req.requestId);
  }
  @Get("references")
  @Header("Cache-Control", "no-store")
  references(
    @Query("cursor") cursor: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.references(user.id, cursor, actor, req.requestId);
  }
  @Post("references")
  @Header("Cache-Control", "no-store")
  saveReference(
    @Body() input: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.saveReference(user.id, input, actor, req.requestId);
  }
  @Post("references/:id/void")
  @Header("Cache-Control", "no-store")
  voidReference(
    @Param("id") id: string,
    @Body() input: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.voidReference(user.id, id, input, actor, req.requestId);
  }
  @Post("analyses")
  @Header("Cache-Control", "no-store")
  generate(
    @Body() input: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.generate(user.id, input, actor, req.requestId);
  }
  @Get("analyses/:id")
  @Header("Cache-Control", "no-store")
  result(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithContext,
  ) {
    const actor = { type: "MEMBER" as const, id: user.id };
    return this.service.result(user.id, id, actor, req.requestId);
  }
  @Post("logout")
  @Header("Cache-Control", "no-store")
  logout(@Req() req: RequestWithContext) {
    return this.login.logout((req.header("authorization") || "").slice(7));
  }
}
