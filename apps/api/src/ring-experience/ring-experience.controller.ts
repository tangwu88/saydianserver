import {
  Body, CallHandler, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, NestInterceptor,
  Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { AdminRole } from "@prisma/client";
import type { Response } from "express";
import { AdminAuditInterceptor } from "../admin/admin-audit.interceptor";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { RawResponse } from "../common/raw-response.decorator";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { ringAvailability } from "./ring-contract";
import { RingExperienceService } from "./ring-experience.service";
import { RingFirmware, ringFirmwareLimit } from "./ring-firmware";

@Injectable()
class RingPrivateResponses implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().set({
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, noarchive",
    });
    return next.handle();
  }
}

@Controller("api/saydian-app/v2/ring")
@UseInterceptors(RingPrivateResponses)
export class RingExperienceController {
  constructor(private readonly ring: RingExperienceService, private readonly firmware: RingFirmware) {}

  @Get("capabilities") capabilities() { return ringAvailability(); }

  @Post("shares/open") @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  open(@Body() input: unknown) { return this.ring.openShare(input); }

  @Post("shares/respond") @HttpCode(200)
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  react(@Body() input: unknown) { return this.ring.react(input); }

  @Post("shares/member-response") @HttpCode(200) @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  named(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.ring.react(input, user.id);
  }

  @Post("shares") @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.ring.createShare(user.id, input);
  }

  @Get("shares") @UseGuards(UserAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser) { return this.ring.shares(user.id); }

  @Delete("shares/:id") @UseGuards(UserAuthGuard)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ring.revokeShare(user.id, id);
  }

  @Post("care/invitations/preview") @HttpCode(200)
  @Throttle({ default: { limit: 36, ttl: 60_000 } })
  preview(@Body() input: unknown) { return this.ring.previewInvite(input); }

  @Post("care/invitations") @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  invite(@CurrentUser() user: AuthenticatedUser) { return this.ring.createInvite(user.id); }

  @Get("care/invitations") @UseGuards(UserAuthGuard)
  invites(@CurrentUser() user: AuthenticatedUser) { return this.ring.invites(user.id); }

  @Delete("care/invitations/:id") @UseGuards(UserAuthGuard)
  cancelInvite(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ring.revokeInvite(user.id, id);
  }

  @Post("care/invitations/accept") @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 18, ttl: 60_000 } })
  accept(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.ring.acceptInvite(user.id, input);
  }

  @Get("care/greetings") @UseGuards(UserAuthGuard)
  greetings(@CurrentUser() user: AuthenticatedUser, @Query("after") after?: string) {
    return this.ring.liveGreetings(user.id, after);
  }

  @Get("care/:id/messages") @UseGuards(UserAuthGuard)
  thread(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Query("before") before?: string) {
    return this.ring.thread(user.id, id, before);
  }

  @Post("care/:id/messages") @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  send(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() input: unknown) {
    return this.ring.send(user.id, id, input);
  }

  @Get("care/:id/messages/:message/audio") @UseGuards(UserAuthGuard) @RawResponse()
  async voice(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string,
    @Param("message") message: string, @Res() response: Response) {
    const audio = await this.ring.voice(user.id, id, message);
    response.type("audio/wav").end(Buffer.from(audio));
  }

  @Delete("care/:id/messages/:message") @UseGuards(UserAuthGuard)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("message") message: string) {
    return this.ring.deleteMessage(user.id, id, message);
  }

  @Post("care/:id/messages/:message/report") @UseGuards(UserAuthGuard)
  report(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("message") message: string) {
    return this.ring.report(user.id, id, message);
  }

  @Put("care/:id/settings") @UseGuards(UserAuthGuard)
  settings(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() input: unknown) {
    return this.ring.setting(user.id, id, input);
  }

  @Get("care/:id/goals") @UseGuards(UserAuthGuard)
  goals(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ring.goals(user.id, id);
  }

  @Put("care/:id/goals") @UseGuards(UserAuthGuard)
  goal(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() input: unknown) {
    return this.ring.saveGoal(user.id, id, input);
  }

  @Post("firmware/lookup") @HttpCode(200) @UseGuards(UserAuthGuard)
  lookup(@Body() input: unknown) { return this.firmware.lookup(input); }

  @Get("firmware/packages/:id") @UseGuards(UserAuthGuard) @RawResponse()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async package(@Param("id") id: string, @Res() response: Response) {
    const file = await this.firmware.package(id);
    response.type("application/octet-stream").end(Buffer.from(file));
  }
}

@Controller("api/saydian-app/admin/v1/ring-firmware")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS)
@UseInterceptors(AdminAuditInterceptor, RingPrivateResponses)
export class RingFirmwareAdminController {
  constructor(private readonly firmware: RingFirmware) {}

  @Get() list() { return this.firmware.list(); }

  @Post() @UseInterceptors(FileInterceptor("file", {
    limits: { fileSize: ringFirmwareLimit, files: 1, fields: 12, parts: 13 },
  }))
  stage(@Body() input: unknown, @UploadedFile() file?: Express.Multer.File) {
    return this.firmware.stage(input, file);
  }

  @Put(":id") enable(@Param("id") id: string, @Body() input: unknown) {
    return this.firmware.enable(id, input);
  }
}

@Controller("api/saydian-app/admin/v1/ring-engagement")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS, AdminRole.CUSTOMER_SERVICE)
@UseInterceptors(AdminAuditInterceptor, RingPrivateResponses)
export class RingEngagementAdminController {
  constructor(private readonly ring: RingExperienceService) {}

  @Get() summary() { return this.ring.operationsSummary(); }

  @Delete("reports/:id") remove(@Param("id") id: string) {
    return this.ring.removeReported(id);
  }
}
