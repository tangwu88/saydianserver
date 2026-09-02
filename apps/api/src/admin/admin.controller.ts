import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AdminRole } from "@prisma/client";
import { ApiTags } from "@nestjs/swagger";
import { safeObject } from "../common/crypto";
import {
  CurrentAdmin,
  type RequestWithContext,
} from "../common/request-context";
import {
  AdminAuthGuard,
  AdminAuthService,
  AdminRoles,
} from "./admin-auth";
import { AdminService } from "./admin.service";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";

@ApiTags("admin-auth")
@Controller("api/saydian-app/admin/v1/auth")
export class AdminLoginController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post("login")
  login(@Body() input: unknown) {
    const body = safeObject(input);
    return this.auth.login(String(body.username ?? ""), String(body.password ?? ""));
  }
}

@ApiTags("admin")
@Controller("api/saydian-app/admin/v1")
@UseGuards(AdminAuthGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AdminAuthService,
  ) {}

  @Post("auth/logout")
  async logout(@CurrentAdmin() current: { sessionId: string }) {
    await this.auth.logout(current.sessionId);
    return { loggedOut: true };
  }

  @Get("dashboard")
  dashboard() {
    return this.admin.dashboard();
  }

  @Get("members")
  members(
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.admin.members(search, Number(page ?? 1), Number(pageSize ?? 30));
  }

  @Get("members/:id/health-summary")
  healthSummary(@Param("id") id: string) {
    return this.admin.healthSummary(id);
  }

  @Get("members/:id/health-records")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.HEALTH_AUDITOR)
  rawHealth(
    @CurrentAdmin() current: { id: string },
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Query("limit") limit?: string,
  ) {
    return this.admin.rawHealth(current.id, id, request.requestId, Number(limit ?? 100));
  }

  @Get("care")
  care() {
    return this.admin.care();
  }

  @Get("devices")
  devices() {
    return this.admin.devices();
  }

  @Get("feedback")
  feedback(@Query("status") status?: string) {
    return this.admin.feedback(status);
  }

  @Patch("feedback/:id")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.APP_OPERATIONS,
    AdminRole.CUSTOMER_SERVICE,
  )
  updateFeedback(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.updateFeedback(id, input);
  }

  @Get("articles")
  articles() {
    return this.admin.articles();
  }

  @Get("article-categories")
  articleCategories() {
    return this.admin.articleCategories();
  }

  @Post("article-categories")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_EDITOR)
  createArticleCategory(@Body() input: unknown) {
    return this.admin.saveArticleCategory(undefined, input);
  }

  @Patch("article-categories/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_EDITOR)
  updateArticleCategory(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveArticleCategory(id, input);
  }

  @Post("articles")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_EDITOR)
  createArticle(@Body() input: unknown) {
    return this.admin.saveArticle(undefined, input);
  }

  @Patch("articles/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_EDITOR)
  updateArticle(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveArticle(id, input);
  }

  @Get("integrations")
  integrations() {
    return this.admin.integrations();
  }

  @Patch("integrations/:key")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  updateIntegration(@Param("key") key: string, @Body() input: unknown) {
    return this.admin.updateIntegration(key, input);
  }

  @Get("audit-logs")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.HEALTH_AUDITOR, AdminRole.READ_ONLY)
  audits(@Query("page") page?: string) {
    return this.admin.audits(Number(page ?? 1));
  }

  @Get("warnings")
  warnings(@Query("page") page?: string) {
    return this.admin.warnings(Number(page ?? 1));
  }

  @Get("notifications")
  notifications(@Query("page") page?: string) {
    return this.admin.notifications(Number(page ?? 1));
  }

  @Get("legal-documents")
  legalDocuments() {
    return this.admin.legalDocuments();
  }

  @Post("legal-documents")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_EDITOR)
  createLegalDocument(@Body() input: unknown) {
    return this.admin.saveLegalDocument(undefined, input);
  }

  @Patch("legal-documents/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_EDITOR)
  updateLegalDocument(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveLegalDocument(id, input);
  }

  @Get("admin-users")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  adminUsers() {
    return this.admin.adminUsers();
  }

  @Post("admin-users")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  createAdmin(@Body() input: unknown) {
    return this.admin.createAdmin(input);
  }

  @Patch("admin-users/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  updateAdmin(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.updateAdmin(id, input);
  }

  @Get("account-deletions")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.CUSTOMER_SERVICE)
  deletionRequests() {
    return this.admin.deletionRequests();
  }

  @Get("settings")
  settings() {
    return this.admin.settings();
  }

  @Patch("settings/:key")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS)
  updateSetting(@Param("key") key: string, @Body() input: unknown) {
    return this.admin.updateSetting(key, input);
  }
}
