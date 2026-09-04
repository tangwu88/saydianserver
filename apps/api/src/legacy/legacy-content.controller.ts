import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { NoFilesInterceptor } from "@nestjs/platform-express";
import { ContentService } from "../content/content.service";
import { safeObject } from "../common/crypto";
import { RawResponse } from "../common/raw-response.decorator";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { legacySuccess } from "./legacy-response";
import { LegacyService } from "./legacy.service";

@Controller("api/rf-article")
@RawResponse()
@UseInterceptors(NoFilesInterceptor({ limits: { fields: 20, fieldSize: 2 * 1024 * 1024 } }))
export class LegacyContentController {
  constructor(
    private readonly content: ContentService,
    private readonly legacy: LegacyService,
  ) {}

  @Get("article-cate/index")
  async categories(@Query("pid") parentId?: string) {
    const resolved = await this.legacy.articleCategoryId(parentId);
    const categories = await this.content.categories(resolved);
    return legacySuccess(
      categories.map((category) => ({
        id: category.legacyId ?? category.id,
        pid: category.parentId,
        title: category.name,
        name: category.name,
        sort: category.sort,
      })),
    );
  }

  @Get("article/index")
  async articles(
    @Query("cate_id") category?: string,
    @Query("page") page?: string,
  ) {
    const categoryId = await this.legacy.articleCategoryId(category);
    const result = await this.content.articles(categoryId, Number(page ?? 1), 20);
    return legacySuccess(
      result.items.map((article) =>
        this.legacy.articleContract(article as unknown as Record<string, unknown>),
      ),
    );
  }

  @Get("article/view")
  async article(@Query("id") id: string) {
    const article = await this.content.article(id);
    return legacySuccess(
      this.legacy.articleContract(article as unknown as Record<string, unknown>),
    );
  }

  @Get("article-single/view")
  async single(@Query("id") id: string) {
    const article = await this.content.article(id);
    return legacySuccess(
      this.legacy.articleContract(article as unknown as Record<string, unknown>),
    );
  }

  @Get("chat/index")
  @UseGuards(UserAuthGuard)
  async aiHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query("session_id") sessionId?: string,
  ) {
    const conversations = await this.content.aiHistory(user.id, sessionId);
    const messages = conversations.flatMap((conversation) =>
      conversation.messages.map((message) => ({
        id: message.id,
        session_id: conversation.clientSessionId ?? conversation.id,
        role: message.role,
        message: message.content,
        content: message.content,
        created_at: Math.floor(message.createdAt.valueOf() / 1000),
      })),
    );
    return legacySuccess(messages);
  }

  @Post("chat/create")
  @UseGuards(UserAuthGuard)
  async sendAi(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const result = await this.content.sendAiMessage(user.id, {
      content: body.message,
      sessionId: body.session_id,
    });
    return legacySuccess({
      id: result.id,
      session_id: result.conversationId,
      role: result.role,
      message: result.content,
      content: result.content,
      created_at: result.createdAt,
    });
  }
}
