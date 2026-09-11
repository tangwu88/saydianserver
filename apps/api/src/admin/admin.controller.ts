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

  @Get("auth/me")
  currentAdmin(@CurrentAdmin() current: { id: string; role: string; roles?: string[] }) {
    return { id: current.id, role: current.role, roles: current.roles ?? [current.role] };
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

  @Get("members/:id/profile")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  memberProfile(
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] },
    @Param("id") id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.memberProfile(current, id, request.requestId);
  }

  @Patch("members/:id/profile")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  updateMemberProfile(
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] },
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Body() input: unknown,
  ) {
    return this.admin.updateMemberProfile(current, id, request.requestId, safeObject(input));
  }

  @Patch("members/:id/verification")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  updateMemberVerification(
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] },
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Body() input: unknown,
  ) {
    return this.admin.updateMemberVerification(current, id, request.requestId, safeObject(input));
  }

  @Get("members/:id/health-summary")
  healthSummary(@Param("id") id: string) {
    return this.admin.healthSummary(id);
  }

  @Get("members/:id/health-records")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.HEALTH_AUDITOR)
  rawHealth(
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] },
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Query("limit") limit?: string,
    @Query("reason") reason?: string,
  ) {
    return this.admin.rawHealth(
      current,
      id,
      request.requestId,
      String(reason ?? ""),
      Number(limit ?? 100),
    );
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
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.INTEGRATION_ADMIN)
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

  @Get("commerce-products")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.FINANCE, AdminRole.CUSTOMER_SERVICE, AdminRole.READ_ONLY)
  commerceProducts(
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("status") status?: string,
  ) {
    return this.admin.commerceProducts(search, Number(page ?? 1), status);
  }

  @Post("commerce-products")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  createCommerceProduct(@Body() input: unknown) {
    return this.admin.saveCommerceProduct(undefined, input);
  }

  @Post("commerce-products/batch")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  batchCommerceProducts(@Body() input: unknown) {
    return this.admin.batchCommerceProducts(input);
  }

  @Patch("commerce-products/:id/skus")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  quickUpdateCommerceProductSkus(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.quickUpdateCommerceProductSkus(id, input);
  }

  @Patch("commerce-products/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  updateCommerceProduct(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveCommerceProduct(id, input);
  }

  @Get("commerce-categories")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.FINANCE, AdminRole.CUSTOMER_SERVICE, AdminRole.READ_ONLY)
  commerceCategories() {
    return this.admin.commerceCategories();
  }

  @Post("commerce-categories")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  createCommerceCategory(@Body() input: unknown) {
    return this.admin.saveCommerceCategory(undefined, input);
  }

  @Patch("commerce-categories/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  updateCommerceCategory(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveCommerceCategory(id, input);
  }

  @Get("commerce-banners")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.READ_ONLY)
  commerceBanners() {
    return this.admin.commerceBanners();
  }

  @Post("commerce-banners")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  createCommerceBanner(@Body() input: unknown) {
    return this.admin.saveCommerceBanner(undefined, input);
  }

  @Patch("commerce-banners/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  updateCommerceBanner(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveCommerceBanner(id, input);
  }

  @Get("commerce-business-configs")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.READ_ONLY)
  commerceBusinessConfigs() {
    return this.admin.commerceBusinessConfigs();
  }

  @Patch("commerce-business-configs/:key")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  updateCommerceBusinessConfig(@Param("key") key: string, @Body() input: unknown) {
    return this.admin.updateCommerceBusinessConfig(key, input);
  }

  @Get("commerce-reviews")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.CUSTOMER_SERVICE, AdminRole.READ_ONLY)
  commerceReviews() {
    return this.admin.commerceReviews();
  }

  @Patch("commerce-reviews/:id")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.COMMERCE_OPERATIONS,
    AdminRole.CUSTOMER_SERVICE,
  )
  updateCommerceReview(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.updateCommerceReview(id, input);
  }

  @Get("commerce-orders")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.FINANCE, AdminRole.CUSTOMER_SERVICE, AdminRole.READ_ONLY)
  commerceOrders(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("search") search?: string,
  ) {
    return this.admin.commerceOrders(status, Number(page ?? 1), search);
  }

  @Patch("commerce-orders/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  updateCommerceOrder(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.updateCommerceOrder(id, input);
  }

  @Get("commerce-orders/:id/fulfillment-preview")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  commerceFulfillmentPreview(@Param("id") id: string,
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] }) {
    return this.admin.commerceFulfillmentPreview(id, current);
  }

  @Post("commerce-orders/:id/shipments")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  createCommerceShipment(@Param("id") id: string, @Body() input: unknown,
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] }) {
    return this.admin.createCommerceShipment(id, input, current);
  }

  @Get("commerce-orders/:id/shipping-refunds/preview")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  shippingRefundPreview(@Param("id") id: string) {
    return this.admin.shippingRefundPreview(id);
  }

  @Post("commerce-orders/:id/shipping-refunds")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  createShippingRefund(@Param("id") id: string, @Body() input: unknown,
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] }) {
    return this.admin.createShippingRefund(id, input, current);
  }

  @Get("commerce-after-sales")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.FINANCE, AdminRole.CUSTOMER_SERVICE, AdminRole.READ_ONLY)
  commerceAfterSales(@Query("status") status?: string) {
    return this.admin.commerceAfterSales(status);
  }

  @Patch("commerce-after-sales/:id")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.COMMERCE_OPERATIONS,
    AdminRole.CUSTOMER_SERVICE,
    AdminRole.FINANCE,
  )
  updateCommerceAfterSale(@Param("id") id: string, @Body() input: unknown,
    @CurrentAdmin() current: { id: string; role: string; roles?: string[] }) {
    return this.admin.updateCommerceAfterSale(id, input, current);
  }

  @Get("commerce-coupons")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.CUSTOMER_SERVICE, AdminRole.READ_ONLY)
  commerceCoupons() {
    return this.admin.commerceCoupons();
  }

  @Post("commerce-coupons")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  createCommerceCoupon(@Body() input: unknown) {
    return this.admin.saveCommerceCoupon(undefined, input);
  }

  @Patch("commerce-coupons/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS)
  updateCommerceCoupon(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveCommerceCoupon(id, input);
  }

  @Get("commerce-employees")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.FINANCE, AdminRole.READ_ONLY)
  commerceEmployees() {
    return this.admin.commerceEmployees();
  }

  @Get("commerce-commissions")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.COMMERCE_OPERATIONS,
    AdminRole.FINANCE,
    AdminRole.READ_ONLY,
  )
  commerceCommissions() {
    return this.admin.commerceCommissions();
  }

  @Patch("commerce-commissions/plan")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  saveCommerceCommissionPlan(@Body() input: unknown) {
    return this.admin.saveCommerceCommissionPlan(input);
  }

  @Get("commerce-jobs")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.INTEGRATION_ADMIN, AdminRole.READ_ONLY)
  commerceJobs(@Query("status") status?: string) {
    return this.admin.commerceJobs(status);
  }

  @Post("commerce-jobs/:id/retry")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.COMMERCE_OPERATIONS,
    AdminRole.INTEGRATION_ADMIN,
  )
  retryCommerceJob(@Param("id") id: string) {
    return this.admin.retryCommerceJob(id);
  }

  @Post("commerce-jobs/product-sync")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.COMMERCE_OPERATIONS,
    AdminRole.INTEGRATION_ADMIN,
  )
  queueProductSync(@Body() input: unknown) {
    return this.admin.queueCommerceProductSync(input);
  }

  @Post("commerce-jobs/fulfillment-sync")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.COMMERCE_OPERATIONS,
    AdminRole.INTEGRATION_ADMIN,
  )
  queueFulfillmentSync() {
    return this.admin.queueCommerceFulfillmentSync();
  }

  @Get("payments")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.FINANCE,
    AdminRole.COMMERCE_OPERATIONS,
    AdminRole.READ_ONLY,
  )
  payments(@Query("status") status?: string, @Query("page") page?: string) {
    return this.admin.payments(status, Number(page ?? 1));
  }

  @Get("health-reports")
  @AdminRoles(
    AdminRole.SUPER_ADMIN,
    AdminRole.HEALTH_AUDITOR,
    AdminRole.CUSTOMER_SERVICE,
    AdminRole.READ_ONLY,
  )
  healthReports(@Query("status") status?: string) {
    return this.admin.healthReports(status);
  }

  @Post("health-reports/:id/retry")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.HEALTH_AUDITOR)
  retryHealthReport(@Param("id") id: string) {
    return this.admin.retryHealthReport(id);
  }

  @Get("health-report-offers")
  healthReportOffers() {
    return this.admin.healthReportOffers();
  }

  @Post("health-report-offers")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  createHealthReportOffer(@Body() input: unknown) {
    return this.admin.saveHealthReportOffer(undefined, input);
  }

  @Patch("health-report-offers/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE)
  updateHealthReportOffer(@Param("id") id: string, @Body() input: unknown) {
    return this.admin.saveHealthReportOffer(id, input);
  }

  @Get("notification-campaigns")
  notificationCampaigns() {
    return this.admin.notificationCampaigns();
  }

  @Post("notification-campaigns")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS)
  createNotificationCampaign(
    @CurrentAdmin() current: { id: string },
    @Body() input: unknown,
  ) {
    return this.admin.saveNotificationCampaign(current.id, undefined, input);
  }

  @Patch("notification-campaigns/:id")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS)
  updateNotificationCampaign(
    @CurrentAdmin() current: { id: string },
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.admin.saveNotificationCampaign(current.id, id, input);
  }

  @Post("notification-campaigns/:id/schedule")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.APP_OPERATIONS)
  scheduleNotificationCampaign(@Param("id") id: string) {
    return this.admin.scheduleNotificationCampaign(id);
  }
}
