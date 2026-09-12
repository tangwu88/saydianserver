import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { CommerceCapabilitiesService } from "./commerce-capabilities.service";
import { CommerceService } from "./commerce.service";

@ApiTags("commerce")
@Controller("api/saydian-app/v2/commerce")
export class CommerceController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly capabilities: CommerceCapabilitiesService,
  ) {}

  @Get("capabilities")
  capabilitiesForApp(@Query("locale") locale?: string) {
    return this.capabilities.publicCapabilities(locale, "app");
  }

  @Get("markets")
  markets() {
    return this.commerce.publicGet("/storefront/markets");
  }

  @Get("home")
  home() {
    return this.commerce.publicGet("/storefront/bootstrap");
  }

  @Get("products")
  products(@Query() query: Record<string, string>) {
    const params = new URLSearchParams(query).toString();
    return this.commerce.publicGet(
      `/storefront/products${params ? `?${params}` : ""}`,
    );
  }

  @Get("products/:id")
  product(@Param("id") id: string) {
    return this.commerce.publicGet(
      `/storefront/products/${encodeURIComponent(id)}`,
    );
  }

  @Get("cart")
  @UseGuards(UserAuthGuard)
  cart(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.forUser(user.id, "GET", "/cart");
  }

  @Post("cart/items")
  @UseGuards(UserAuthGuard)
  putCart(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.commerce.forUser(user.id, "POST", "/cart/items", body);
  }

  @Delete("cart/items/:id")
  @UseGuards(UserAuthGuard)
  deleteCart(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.forUser(
      user.id,
      "DELETE",
      `/cart/items/${encodeURIComponent(id)}`,
    );
  }

  @Get("addresses")
  @UseGuards(UserAuthGuard)
  addresses(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.forUser(user.id, "GET", "/addresses");
  }

  @Get("addresses/:id")
  @UseGuards(UserAuthGuard)
  address(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.forUser(
      user.id,
      "GET",
      `/addresses/${encodeURIComponent(id)}`,
    );
  }

  @Post("addresses")
  @UseGuards(UserAuthGuard)
  saveAddress(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.commerce.forUser(user.id, "POST", "/addresses", body);
  }

  @Patch("addresses/:id")
  @UseGuards(UserAuthGuard)
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "PATCH",
      `/addresses/${encodeURIComponent(id)}`,
      body,
    );
  }

  @Delete("addresses/:id")
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

  @Get("orders")
  @UseGuards(UserAuthGuard)
  orders(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
    @Query("group") group?: string,
  ) {
    return this.commerce.orders(user.id, status, group);
  }

  @Post("orders/preview")
  @UseGuards(UserAuthGuard)
  previewOrder(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.commerce.forUser(user.id, "POST", "/orders/preview", body);
  }

  @Get("orders/:id")
  @UseGuards(UserAuthGuard)
  order(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.orderDetail(user.id, id);
  }

  @Post("orders")
  @UseGuards(UserAuthGuard)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "POST",
      "/orders",
      body,
      idempotencyKey,
    );
  }

  @Post("orders/:id/receipt")
  @UseGuards(UserAuthGuard)
  receipt(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/receipt`,
    );
  }

  @Post("orders/:id/cancel")
  @UseGuards(UserAuthGuard)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/cancel`,
    );
  }

  @Post("orders/:id/after-sales")
  @UseGuards(UserAuthGuard)
  afterSales(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/after-sales`,
      body,
    );
  }

  @Post("orders/:id/after-sales/preview")
  @UseGuards(UserAuthGuard)
  previewAfterSale(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/after-sales/preview`,
      body,
    );
  }

  @Post("orders/:id/after-sales/:saleId/return-logistics")
  @UseGuards(UserAuthGuard)
  returnLogistics(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("saleId") saleId: string,
    @Body() body: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/after-sales/${encodeURIComponent(saleId)}/return-logistics`,
      body,
    );
  }

  @Get("orders/:id/logistics")
  @UseGuards(UserAuthGuard)
  logistics(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.forUser(
      user.id,
      "GET",
      `/orders/${encodeURIComponent(id)}/logistics`,
    );
  }

  @Post("payments")
  @UseGuards(UserAuthGuard)
  payment(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.commerce.forUser(
      user.id,
      "POST",
      "/payments",
      body,
      idempotencyKey,
    );
  }

  @Get("favorites")
  @UseGuards(UserAuthGuard)
  favorites(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.favorites(user.id);
  }

  @Put("products/:id/favorite")
  @UseGuards(UserAuthGuard)
  favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { enabled?: boolean },
  ) {
    return this.commerce.setFavorite(user.id, id, body.enabled !== false);
  }

  @Get("coupons")
  @UseGuards(UserAuthGuard)
  coupons(@CurrentUser() user: AuthenticatedUser) {
    return this.commerce.coupons(user.id);
  }

  @Get("coupons/available")
  @UseGuards(UserAuthGuard)
  availableCoupons(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
  ) {
    return this.commerce.availableCoupons(user.id, Number(page ?? 1));
  }

  @Post("coupons/code/claim")
  @UseGuards(UserAuthGuard)
  claimCouponByCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.commerce.claimCouponByCode(user.id, body);
  }

  @Post("coupons/:id/claim")
  @UseGuards(UserAuthGuard)
  claimCoupon(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.commerce.claimCoupon(user.id, id);
  }

  @Post("reviews")
  @UseGuards(UserAuthGuard)
  review(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.commerce.createReview(user.id, body);
  }

  @Get("points")
  @UseGuards(UserAuthGuard)
  points(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string) {
    return this.commerce.points(user.id, Number(page ?? 1));
  }
}
