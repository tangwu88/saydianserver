import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminRole } from "@prisma/client";
import type { Response } from "express";
import { PrismaService } from "../common/prisma.service";
import { RawResponse } from "../common/raw-response.decorator";
import type { RequestWithContext } from "../common/request-context";
import {
  supportSeq,
  writeSupportImage,
} from "../support/online-support.controller";
import {
  normalizeSupportImage,
  staffSupportAccess,
  supportAttachmentLimit,
  SupportConversations,
} from "../support/support-conversations";
import { SupportContent } from "../support/support-content";
import { supportEvents } from "../support/support-events";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";
import { AdminAuthGuard, AdminRoles } from "./admin-auth";

@Controller("api/saydian-app/admin/v1/support-chat")
@UseGuards(AdminAuthGuard)
@UseInterceptors(AdminAuditInterceptor)
@AdminRoles(
  AdminRole.SUPER_ADMIN,
  AdminRole.CUSTOMER_SERVICE,
  AdminRole.APP_OPERATIONS,
)
export class AdminOnlineSupportController {
  constructor(
    private readonly chat: SupportConversations,
    private readonly content: SupportContent,
    private readonly prisma: PrismaService,
  ) {}

  private actor(request: RequestWithContext) {
    return { staffId: request.authAdmin!.id };
  }

  private async authorize(request: RequestWithContext) {
    const session = await this.prisma.adminSession.findFirst({
      where: {
        id: request.authAdmin!.sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        admin: { active: true },
      },
      select: { admin: { select: { role: true, roles: true } } },
    });
    if (!session || !staffSupportAccess(session.admin))
      throw new UnauthorizedException();
  }

  @Get("queues")
  @Header("Cache-Control", "private, no-store")
  queues(
    @Req() request: RequestWithContext,
    @Query("filter") filter?: string,
    @Query("before") before?: string,
  ) {
    return this.chat.list(this.actor(request), filter, before);
  }

  @Get("queues/events")
  @Header("Cache-Control", "private, no-store")
  @RawResponse()
  queueEvents(
    @Req() request: RequestWithContext,
    @Res() response: Response,
    @Query("filter") filter?: string,
  ) {
    const actor = this.actor(request);
    return supportEvents(
      response,
      `staff-queue:${actor.staffId}`,
      () => this.chat.list(actor, filter),
      () => this.authorize(request),
    );
  }

  @Get("agents")
  @Header("Cache-Control", "private, no-store")
  agents() {
    return this.chat.agents();
  }

  @Get("config")
  @Header("Cache-Control", "private, no-store")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS)
  config() {
    return this.content.adminConfig();
  }

  @Put("config")
  @Header("Cache-Control", "private, no-store")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS)
  saveConfig(@Body() input: unknown) {
    return this.content.saveConfig(input);
  }

  @Get("conversations/:id")
  @Header("Cache-Control", "private, no-store")
  detail(
    @Req() request: RequestWithContext,
    @Param("id") id: string,
    @Query("after") after?: string,
    @Query("before") before?: string,
  ) {
    return this.chat.snapshot(this.actor(request), id, {
      after: supportSeq(after),
      before: supportSeq(before),
    });
  }

  @Get("conversations/:id/events")
  @Header("Cache-Control", "private, no-store")
  @RawResponse()
  events(
    @Req() request: RequestWithContext,
    @Res() response: Response,
    @Param("id") id: string,
    @Query("after") after?: string,
  ) {
    const actor = this.actor(request);
    let cursor = supportSeq(after) ?? 0;
    return supportEvents(
      response,
      `staff-thread:${actor.staffId}`,
      async () => {
        const result = await this.chat.snapshot(actor, id, { after: cursor });
        cursor = result.messages.at(-1)?.seq ?? cursor;
        return result;
      },
      () => this.authorize(request),
    );
  }

  @Get("conversations/:id/diagnostics")
  @Header("Cache-Control", "private, no-store")
  diagnostics(@Req() request: RequestWithContext, @Param("id") id: string) {
    return this.chat.diagnostics(this.actor(request), id, request.requestId);
  }

  @Post("conversations/:id/messages")
  @Header("Cache-Control", "private, no-store")
  send(
    @Req() request: RequestWithContext,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.chat.send(this.actor(request), id, input);
  }

  @Post("conversations/:id/attachments")
  @Header("Cache-Control", "private, no-store")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: supportAttachmentLimit + 1,
        files: 1,
        fields: 2,
        fieldSize: 10_000,
      },
    }),
  )
  async sendImage(
    @Req() request: RequestWithContext,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() input: unknown,
  ) {
    const actor = this.actor(request);
    await this.chat.assertParticipant(actor, id);
    return this.chat.send(actor, id, input, await normalizeSupportImage(file));
  }

  @Get("conversations/:id/attachments/:attachmentId")
  @Header("Cache-Control", "private, no-store")
  @RawResponse()
  async image(
    @Req() request: RequestWithContext,
    @Res() response: Response,
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    writeSupportImage(
      response,
      await this.chat.image(this.actor(request), id, attachmentId),
    );
  }

  @Post("conversations/:id/read")
  @Header("Cache-Control", "private, no-store")
  read(
    @Req() request: RequestWithContext,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.chat.read(this.actor(request), id, input);
  }

  @Post("conversations/:id/transition")
  @Header("Cache-Control", "private, no-store")
  transition(
    @Req() request: RequestWithContext,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.chat.transition(this.actor(request), id, input);
  }
}
