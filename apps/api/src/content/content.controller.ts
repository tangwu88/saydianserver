import { Body, Controller, Get, Header, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ContentService } from "./content.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";

@ApiTags("content")
@Controller("api/saydian-app/v2/content")
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get("categories")
  categories(@Query("parentId") parentId?: string, @Query("locale") locale?: string, @Headers("accept-language") language?: string, @Query("product") product?: string) {
    return this.content.categories(parentId, locale ?? language, product);
  }

  @Get("articles")
  articles(
    @Query("categoryId") categoryId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("locale") locale?: string,
    @Headers("accept-language") language?: string,
    @Query("product") product?: string,
  ) {
    return this.content.articles(categoryId, Number(page ?? 1), Number(pageSize ?? 20), locale ?? language, product);
  }

  @Get("articles/:id")
  article(@Param("id") id: string, @Query("locale") locale?: string, @Headers("accept-language") language?: string, @Query("product") product?: string) {
    return this.content.article(id, locale ?? language, product);
  }

  @Get("legal/:type")
  legal(@Param("type") type: string, @Query("version") version?: string, @Query("locale") locale?: string) {
    return this.content.legalDocument(type, version, locale);
  }

  @Get("legal-page/say-ring/:type")
  @RawResponse()
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  sayRingLegalPage(@Param("type") type: string) {
    return this.content.sayRingLegalPage(type);
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
