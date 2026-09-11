import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService } from "../auth/auth.service";
import { WechatH5AuthService } from "../auth/wechat-h5-auth.service";
import { CommerceCapabilitiesService } from "./commerce-capabilities.service";
import { Throttle } from "@nestjs/throttler";
import { BillingService } from "../billing/billing.service";
import { safeObject } from "../common/crypto";
import { RawResponse } from "../common/raw-response.decorator";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CommerceService } from "./commerce.service";
import { isGlobalRealm } from "../common/deployment-realm";

type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Compatibility surface for the H5/mini-program code migrated from
 * saidian-mall@09963c49f255c146ffab2bfd17b8d0961c655ebd. Responses remain
 * unwrapped so an already published client can move to the unified host.
 */
@ApiTags("commerce-compatibility")
@Controller("api/saidian-mall/v1")
@RawResponse()
export class CommerceCompatibilityController {
  constructor(
    private readonly auth: AuthService,
    private readonly commerce: CommerceService,
    private readonly billing: BillingService,
    private readonly wechatH5: WechatH5AuthService,
    private readonly capabilities: CommerceCapabilitiesService,
  ) {}

  @Post("auth/password/login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  loginPassword(@Body() input: unknown) {
    const body = safeObject(input);
    return this.auth.loginForMall(String((isGlobalRealm() ? body.identifier ?? body.mobile : body.mobile) ?? ""), String(body.password ?? ""),
      body.referralCode ? String(body.referralCode) : undefined);
  }

  @Post("auth/wechat/h5/authorize-url")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  authorizeWechatH5(@Body() input: unknown) {
    const body = safeObject(input);
    return this.wechatH5.authorize({ returnTo: String(body.returnTo ?? "/"), codeChallenge: String(body.codeChallenge ?? ""),
      consentVersion: String(body.consentVersion ?? ""), locale: body.locale,
      ...(body.referralCode ? { referralCode: String(body.referralCode) } : {}) });
  }

  @Post("auth/wechat/h5/login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  loginWechatH5(@Body() input: unknown) {
    const body = safeObject(input);
    return this.wechatH5.login({ code: String(body.code ?? ""), state: String(body.state ?? ""),
      codeVerifier: String(body.codeVerifier ?? ""), consentVersion: String(body.consentVersion ?? ""), locale: body.locale });
  }

  @Post("auth/wechat/h5/bind-mobile")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  bindWechatH5Mobile(@Body() input: unknown) {
    const body = safeObject(input);
    return this.wechatH5.bindMobile({ bindTicket: String(body.bindTicket ?? ""), mobile: String(body.mobile ?? ""),
      code: String(body.code ?? ""), consentVersion: String(body.consentVersion ?? "") });
  }

  @Post("auth/wechat/h5/bind-account")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  bindWechatH5Account(@Body() input: unknown) { return this.wechatH5.bindGlobalAccount(input); }

  @Post("auth/wechat/h5/binding-code")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestWechatH5BindingCode(@Body() input: unknown) { return this.wechatH5.requestGlobalBindingCode(input); }

  @Post("auth/wechat/h5/bind-code")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  bindWechatH5Code(@Body() input: unknown) { return this.wechatH5.bindGlobalCode(input); }

  @Post("auth/wechat/h5/phone-code")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestWechatH5PhoneCode(@Body() input: unknown) { return this.wechatH5.requestGlobalPhoneCode(input); }

  @Post("auth/wechat/h5/bind-phone")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  bindWechatH5Phone(@Body() input: unknown) { return this.wechatH5.bindGlobalPhone(input); }

  @Get("auth/wechat/h5/account")
  @UseGuards(UserAuthGuard)
  wechatH5Account(@CurrentUser() user: AuthenticatedUser) { return this.auth.mallAccount(user.id, user.sessionId); }

  @Get("storefront/capabilities")
  storefrontCapabilities(@Query("locale") locale?: string) { return this.capabilities.publicCapabilities(locale); }

  @Get("payments/:id")
  @UseGuards(UserAuthGuard)
  payment(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.billing.payment(user.id, id);
  }

  @Post("auth/sms/request")
  async requestSms(@Body() input: unknown) {
    const body = safeObject(input);
    const result = await this.auth.requestSmsCode(String(body.mobile ?? ""), body.usage === "bind_mobile" ? "bind_mobile" : "login");
    return { configured: true, ...result };
  }

  @Post("auth/sms/login")
  loginSms(@Body() input: unknown) {
    const body = safeObject(input);
    return this.auth.loginWithSms({
      mobile: String(body.mobile ?? ""),
      code: String(body.code ?? ""),
      consentVersion: String(body.consentVersion ?? ""),
      consentSource: "commerce_sms",
      ...(body.referralCode ? { referralCode: String(body.referralCode) } : {}),
    });
  }

  @Post("auth/wechat/mini")
  loginWechatMini(@Body() input: unknown) {
    const body = safeObject(input);
    return this.auth.loginWechatMini({
      code: String(body.code ?? ""),
      consentVersion: String(body.consentVersion ?? ""),
      consentSource: "commerce_mini_program",
      ...(body.referralCode ? { referralCode: String(body.referralCode) } : {}),
    });
  }

  @Post("auth/refresh")
  refresh(@Body() input: unknown) {
    return this.auth.refreshForMall(
      String(safeObject(input).refreshToken ?? ""),
    );
  }

  @Post("auth/referral")
  @UseGuards(UserAuthGuard)
  referral(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return this.auth.bindReferral(
      user.id,
      String(safeObject(input).referralCode ?? ""),
    );
  }

  @Get("storefront/bootstrap")
  async bootstrap(@Query("ref") referralCode?: string) {
    const suffix = referralCode ? `?referralCode=${encodeURIComponent(referralCode)}` : "";
    const [storefront, capabilities] = await Promise.all([this.commerce.publicGet(`/storefront/bootstrap${suffix}`), this.capabilities.publicCapabilities()]);
    return { ...storefront, capabilities };
  }

  @Get("storefront/products")
  products(@Query() query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return this.commerce.publicGet(`/storefront/products${params ? `?${params}` : ""}`);
  }

  @Get("storefront/products/:id")
  product(@Param("id") id: string) {
    return this.commerce.publicGet(`/storefront/products/${encodeURIComponent(id)}`);
  }

  @Get("storefront/cart")
  @UseGuards(UserAuthGuard)
  cart(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.forUser(user.id, "GET", "/cart");
  }

  @Post("storefront/cart/items")
  @UseGuards(UserAuthGuard)
  putCart(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return this.commerce.forUser(user.id, "POST", "/cart/items", input);
  }

  @Delete("storefront/cart/items/:id")
  @UseGuards(UserAuthGuard)
  deleteCart(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.forUser(
      user.id,
      "DELETE",
      `/cart/items/${encodeURIComponent(id)}`,
    );
  }

  @Get("storefront/addresses")
  @UseGuards(UserAuthGuard)
  addresses(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.forUser(user.id, "GET", "/addresses");
  }

  @Post("storefront/addresses")
  @UseGuards(UserAuthGuard)
  saveAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const id = String(body.id ?? "").trim();
    return this.commerce.forUser(
      user.id,
      id ? "PATCH" : "POST",
      id ? `/addresses/${encodeURIComponent(id)}` : "/addresses",
      body,
    );
  }

  @Patch("storefront/addresses/:id")
  @UseGuards(UserAuthGuard)
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "PATCH",
      `/addresses/${encodeURIComponent(id)}`,
      input,
    );
  }

  @Delete("storefront/addresses/:id")
  @UseGuards(UserAuthGuard)
  deleteAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.commerce.forUser(
      user.id,
      "DELETE",
      `/addresses/${encodeURIComponent(id)}`,
    );
  }

  @Post("storefront/orders/preview")
  @UseGuards(UserAuthGuard)
  previewOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return this.commerce.forUser(user.id, "POST", "/orders/preview", input);
  }

  @Post("storefront/orders")
  @UseGuards(UserAuthGuard)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "POST",
      "/orders",
      input,
      idempotencyKey,
    );
  }

  @Get("storefront/orders")
  @UseGuards(UserAuthGuard)
  orders(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
    @Query("group") group?: string,
  ) {
    return this.commerce.orders(user.id, status, group);
  }

  @Get("storefront/orders/:id")
  @UseGuards(UserAuthGuard)
  order(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.orderDetail(user.id, id);
  }

  @Post("storefront/orders/:id/cancel")
  @UseGuards(UserAuthGuard)
  async cancelOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    await this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/cancel`,
    );
    return { ok: true };
  }

  @Post("storefront/orders/:id/receipt")
  @UseGuards(UserAuthGuard)
  async receiveOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    await this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/receipt`,
    );
    return { ok: true };
  }

  @Post("storefront/orders/:id/after-sales")
  @UseGuards(UserAuthGuard)
  afterSale(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/after-sales`,
      input,
    );
  }

  @Post("storefront/orders/:id/after-sales/:saleId/return-logistics")
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  returnLogistics(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("saleId") saleId: string, @Body() input: unknown) {
    return this.commerce.forUser(user.id, "POST", `/orders/${encodeURIComponent(id)}/after-sales/${encodeURIComponent(saleId)}/return-logistics`, input);
  }

  @Post("storefront/orders/:id/after-sales/preview")
  @UseGuards(UserAuthGuard)
  previewAfterSale(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() input: unknown) {
    return this.commerce.forUser(user.id, "POST", `/orders/${encodeURIComponent(id)}/after-sales/preview`, input);
  }

  @Get("storefront/points")
  @UseGuards(UserAuthGuard)
  points(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string) {
    return this.commerce.points(user.id, Number(page ?? 1));
  }

  @Get("storefront/orders/:id/logistics")
  @UseGuards(UserAuthGuard)
  logistics(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.forUser(
      user.id,
      "GET",
      `/orders/${encodeURIComponent(id)}/logistics`,
    );
  }

  @Get("storefront/favorites")
  @UseGuards(UserAuthGuard)
  favorites(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.favorites(user.id);
  }

  @Post("storefront/favorites/:productId")
  @UseGuards(UserAuthGuard)
  async favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param("productId") productId: string,
    @Body() input: unknown,
  ) {
    const result = await this.commerce.setFavorite(
      user.id,
      productId,
      safeObject(input).enabled !== false,
    );
    return result ?? { ok: true };
  }

  @Get("storefront/coupons")
  @UseGuards(UserAuthGuard)
  coupons(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.coupons(user.id);
  }

  @Post("storefront/coupons/:id/claim")
  @UseGuards(UserAuthGuard)
  claimCoupon(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.claimCoupon(user.id, id);
  }

  @Get("storefront/coupons/available")
  @UseGuards(UserAuthGuard)
  availableCoupons(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string) {
    return this.commerce.availableCoupons(user.id, Number(page ?? 1));
  }

  @Post("storefront/reviews")
  @UseGuards(UserAuthGuard)
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return this.commerce.createReview(user.id, input);
  }

  @Post("payments/create")
  @UseGuards(UserAuthGuard)
  createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
    @Req() request: Request,
  ) {
    const body = safeObject(input);
    const channel = String(body.channel ?? "").trim().toLowerCase();
    const orderId = String(body.orderId ?? body.order_id ?? "").trim();
    return this.billing.createPayment(
      user.id,
      {
        businessType: "commerce_order",
        businessId: orderId,
        channel,
        platform: channel === "wechat_mini" ? "mini_program" : "h5",
        idempotencyKey: String(
          body.idempotencyKey ?? `commerce-payment:${orderId}:${channel}`,
        ),
      },
      request.ip ? { clientIp: request.ip } : {},
    );
  }

  @Post("payments/wechat/notify")
  @HttpCode(200)
  wechatNotify(
    @Headers() headers: Record<string, string | undefined>,
    @Body() input: unknown,
    @Req() request: RequestWithRawBody,
  ) {
    return this.billing.handleWechatNotification(
      headers,
      input,
      request.rawBody ?? Buffer.from(JSON.stringify(input)),
    );
  }

  @Post("payments/wechat/refund-notify")
  @HttpCode(200)
  wechatRefundNotify(
    @Headers() headers: Record<string, string | undefined>,
    @Body() input: unknown,
    @Req() request: RequestWithRawBody,
  ) {
    return this.billing.handleWechatRefundNotification(
      headers,
      input,
      request.rawBody ?? Buffer.from(JSON.stringify(input)),
    );
  }

  @Post("payments/alipay/notify")
  @HttpCode(200)
  async alipayNotify(
    @Body() input: Record<string, string>,
    @Res() response: Response,
  ) {
    const payload = Object.fromEntries(
      Object.entries(safeObject(input)).map(([key, value]) => [key, String(value)]),
    );
    response.type("text/plain").send(await this.billing.handleAlipayNotification(payload));
  }
}
