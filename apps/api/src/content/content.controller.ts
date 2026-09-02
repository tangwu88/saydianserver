import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ContentService } from "./content.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";

@ApiTags("content")
@Controller("api/saydian-app/v2/content")
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get("categories")
  categories(@Query("parentId") parentId?: string) {
    return this.content.categories(parentId);
  }

  @Get("articles")
  articles(
    @Query("categoryId") categoryId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.content.articles(categoryId, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Get("articles/:id")
  article(@Param("id") id: string) {
    return this.content.article(id);
  }

  @Get("legal/:type")
  legal(@Param("type") type: string, @Query("version") version?: string) {
    return this.content.legalDocument(type, version);
  }
}

@ApiTags("ai")
@Controller("api/saydian-app/v2/ai")
@UseGuards(UserAuthGuard)
export class AiController {
  constructor(private readonly content: ContentService) {}

  @Get("messages")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query("sessionId") sessionId?: string,
  ) {
    return this.content.aiHistory(user.id, sessionId);
  }

  @Post("messages")
  send(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.content.sendAiMessage(user.id, input);
  }
}
