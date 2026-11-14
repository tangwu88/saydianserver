import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Headers,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { safeObject } from "../common/crypto";
import { RawResponse } from "../common/raw-response.decorator";
import type { RequestWithContext } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { SupportContent } from "./support-content";
import {
  normalizeSupportImage,
  supportAttachmentLimit,
  SupportActor,
  SupportConversations,
  supportGuestPrefix,
} from "./support-conversations";
import { supportEvents } from "./support-events";

type SupportRequest = RequestWithContext & {
  supportActor: SupportActor;
  supportReauthorize: () => Promise<unknown>;
};

@Injectable()
export class SupportAccessGuard implements CanActivate {
  constructor(
    private readonly auth: UserAuthGuard,
    private readonly conversations: SupportConversations,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SupportRequest>();
    const token =
      /^Bearer (.+)$/i.exec(request.header("authorization") ?? "")?.[1] ?? "";
    if (!token) throw new UnauthorizedException("请打开客服会话");
    const check = async () => {
      if (token.startsWith(supportGuestPrefix))
        return this.conversations.guest(token);
      await this.auth.canActivate(context);
      return { userId: request.authUser!.id };
    };
    request.supportActor = await check();
    request.supportReauthorize = check;
    return true;
  }
}

export function supportSeq(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^\d{1,10}$/.test(value) || Number(value) > 2_147_483_647)
    throw new BadRequestException("无效的消息页码");
  return Number(value);
}

export function writeSupportImage(response: Response, bytes: Uint8Array) {
  response.set({
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  response.end(Buffer.from(bytes));
}

@Controller("api/saydian-app/v2/support")
export class OnlineSupportController {
  constructor(
    private readonly content: SupportContent,
    private readonly chat: SupportConversations,
  ) {}

  @Get("online-config")
  @Header("Cache-Control", "private, no-store")
  config(@Headers("accept-language") locale?: string) {
    return this.content.publicConfig(locale);
  }

  @Get("faq")
  @Header("Cache-Control", "private, no-store")
  faq(
    @Headers("accept-language") locale?: string,
    @Query("q") query?: string,
    @Query("offset") offset?: string,
    @Query("language") language?: string,
  ) {
    return this.content.faq(language ?? locale, query, offset);
  }

  @Get("faq/:id")
  @Header("Cache-Control", "private, no-store")
  article(@Param("id") id: string) {
    return this.content.article(id);
  }

  @Post("guest")
  @Header("Cache-Control", "private, no-store")
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  guest(@Headers("accept-language") locale?: string) {
    return this.chat.newGuest(locale);
  }

  @Post("conversations")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
  start(
    @Req() request: SupportRequest,
    @Headers("accept-language") locale?: string,
  ) {
    return this.chat.start(request.supportActor, locale);
  }

  @Get("conversations")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
  list(@Req() request: SupportRequest, @Query("before") before?: string) {
    return this.chat.list(request.supportActor, undefined, before);
  }

  @Get("conversations/:id")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
  detail(
    @Req() request: SupportRequest,
    @Param("id") id: string,
    @Query("after") after?: string,
    @Query("before") before?: string,
  ) {
    return this.chat.snapshot(request.supportActor, id, {
      after: supportSeq(after),
      before: supportSeq(before),
    });
  }

  @Get("conversations/:id/events")
  @Header("Cache-Control", "private, no-store")
  @RawResponse()
  @UseGuards(SupportAccessGuard)
  events(
    @Req() request: SupportRequest,
    @Res() response: Response,
    @Param("id") id: string,
    @Query("after") after?: string,
  ) {
    let cursor = supportSeq(after) ?? 0;
    const actor = request.supportActor;
    const key =
      "userId" in actor
        ? `member:${actor.userId}`
        : `guest:${"guestId" in actor ? actor.guestId : "invalid"}`;
    return supportEvents(
      response,
      key,
      async () => {
        const result = await this.chat.snapshot(actor, id, { after: cursor });
        cursor = result.messages.at(-1)?.seq ?? cursor;
        return result;
      },
      request.supportReauthorize,
    );
  }

  @Post("conversations/:id/messages")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
  send(
    @Req() request: SupportRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.chat.send(request.supportActor, id, input);
  }

  @Post("conversations/:id/attachments")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
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
    @Req() request: SupportRequest,
    @Param("id") id: string,
    @Body() input: unknown,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.chat.assertParticipant(request.supportActor, id);
    return this.chat.send(
      request.supportActor,
      id,
      input,
      await normalizeSupportImage(file),
    );
  }

  @Get("conversations/:id/attachments/:attachmentId")
  @Header("Cache-Control", "private, no-store")
  @RawResponse()
  @UseGuards(SupportAccessGuard)
  async image(
    @Req() request: SupportRequest,
    @Res() response: Response,
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    writeSupportImage(
      response,
      await this.chat.image(request.supportActor, id, attachmentId),
    );
  }

  @Post("conversations/:id/read")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
  read(
    @Req() request: SupportRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.chat.read(request.supportActor, id, input);
  }

  @Post("conversations/:id/handoff")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
  handoff(@Req() request: SupportRequest, @Param("id") id: string) {
    return this.chat.transition(request.supportActor, id, {
      action: "handoff",
    });
  }

  @Post("conversations/:id/claim")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(UserAuthGuard)
  claim(
    @Req() request: RequestWithContext,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.chat.claim(
      { userId: request.authUser!.id },
      id,
      safeObject(input).guestToken,
    );
  }

  @Post("conversations/:id/diagnostic")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(SupportAccessGuard)
  diagnostic(
    @Req() request: SupportRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.chat.guestDiagnostic(request.supportActor, id, input);
  }
}
