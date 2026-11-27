import {
  Body, CallHandler, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, NestInterceptor,
  NotFoundException, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { AdminRole } from "@prisma/client";
import type { Response } from "express";
import { AdminAuditInterceptor } from "../admin/admin-audit.interceptor";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { RawResponse } from "../common/raw-response.decorator";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { cnRingProduct, ringClientAvailability, ringClientProduct } from "./ring-contract";
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

  @Get("capabilities") capabilities(@Query("product") product?: string,
    @Query("clientRevision") revision?: string) { return ringClientAvailability(product, revision); }

  @Post("shares/open") @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  open(@Body() input: unknown, @Query("product") product?: string) { return this.ring.openShare(input, ringClientProduct(product)); }

  @Post("shares/respond") @HttpCode(200)
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  react(@Body() input: unknown, @Query("product") product?: string) { return this.ring.react(input, undefined, ringClientProduct(product)); }

  @Post("shares/member-response") @HttpCode(200) @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  named(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown, @Query("product") product?: string) {
    return this.ring.react(input, user.id, ringClientProduct(product));
  }

  @Post("shares") @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown, @Query("product") product?: string) {
    return this.ring.createShare(user.id, input, ringClientProduct(product));
  }

  @Get("shares") @UseGuards(UserAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser, @Query("history") history?: string,
    @Query("before") before?: string, @Query("product") product?: string) {
    return this.ring.shares(user.id, history === "true", before, ringClientProduct(product));
  }

  @Get("shares/:id") @UseGuards(UserAuthGuard)
  replies(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Query("before") before?: string, @Query("product") product?: string) {
    return this.ring.shareReplies(user.id, id, before, ringClientProduct(product));
  }

  @Delete("shares/:id") @UseGuards(UserAuthGuard)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Query("product") product?: string) {
    return this.ring.revokeShare(user.id, id, ringClientProduct(product));
  }

  @Post("care/invitations/preview") @HttpCode(200)
  @Throttle({ default: { limit: 36, ttl: 60_000 } })
  preview(@Body() input: unknown, @Query("product") product?: string) { return this.ring.previewInvite(input, ringClientProduct(product)); }

  @Post("care/invitations") @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  invite(@CurrentUser() user: AuthenticatedUser, @Query("product") product?: string) { return this.ring.createInvite(user.id, ringClientProduct(product)); }

  @Get("care/invitations") @UseGuards(UserAuthGuard)
  invites(@CurrentUser() user: AuthenticatedUser, @Query("product") product?: string) { return this.ring.invites(user.id, ringClientProduct(product)); }

  @Delete("care/invitations/:id") @UseGuards(UserAuthGuard)
  cancelInvite(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Query("product") product?: string) {
    return this.ring.revokeInvite(user.id, id, ringClientProduct(product));
  }

  @Post("care/invitations/accept") @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 18, ttl: 60_000 } })
  accept(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown, @Query("product") product?: string) {
    return this.ring.acceptInvite(user.id, input, ringClientProduct(product));
  }

  @Get("care/greetings") @UseGuards(UserAuthGuard)
  greetings(@CurrentUser() user: AuthenticatedUser, @Query("after") after?: string, @Query("product") product?: string) {
    return this.ring.liveGreetings(user.id, after, ringClientProduct(product));
  }

  @Get("care/:id/messages") @UseGuards(UserAuthGuard)
  thread(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Query("before") before?: string, @Query("product") product?: string) {
    return this.ring.thread(user.id, id, before, ringClientProduct(product));
  }

  @Post("care/:id/messages") @UseGuards(UserAuthGuard)
  // Authenticated senders have a transactional per-member limit in send().
  // A shared network address must not consume another member's allowance.
  @SkipThrottle()
  send(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() input: unknown, @Query("product") product?: string) {
    return this.ring.send(user.id, id, input, ringClientProduct(product));
  }

  @Get("care/:id/messages/:message/audio") @UseGuards(UserAuthGuard) @RawResponse()
  async voice(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string,
    @Param("message") message: string, @Res() response: Response, @Query("product") product?: string) {
    const audio = await this.ring.voice(user.id, id, message, ringClientProduct(product));
    response.type("audio/wav").end(Buffer.from(audio));
  }

  @Delete("care/:id/messages/:message") @UseGuards(UserAuthGuard)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("message") message: string, @Query("product") product?: string) {
    return this.ring.deleteMessage(user.id, id, message, ringClientProduct(product));
  }

  @Post("care/:id/messages/:message/report") @UseGuards(UserAuthGuard)
  report(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("message") message: string, @Query("product") product?: string) {
    return this.ring.report(user.id, id, message, ringClientProduct(product));
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
  lookup(@Body() input: unknown, @Query("product") product?: string) {
    if (ringClientProduct(product) === cnRingProduct) throw new NotFoundException("暂不可用");
    return this.firmware.lookup(input);
  }

  @Get("firmware/packages/:id") @UseGuards(UserAuthGuard) @RawResponse()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async package(@Param("id") id: string, @Res() response: Response, @Query("product") product?: string) {
    if (ringClientProduct(product) === cnRingProduct) throw new NotFoundException("暂不可用");
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

  @Get() summary(@Query("product") product?: string) { return this.ring.operationsSummary(ringClientProduct(product)); }

  @Delete("reports/:id") remove(@Param("id") id: string) {
    return this.ring.removeReported(id);
  }
}
