import {
  Body,
  NotFoundException,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { NoFilesInterceptor } from "@nestjs/platform-express";
import { CommerceService } from "../commerce/commerce.service";
import { safeObject, sha256 } from "../common/crypto";
import { RawResponse } from "../common/raw-response.decorator";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { LegacyCommerceMapper } from "./legacy-commerce-mapper.service";
import { legacySuccess } from "./legacy-response";

@Controller("api/v1/pages")
@RawResponse()
export class LegacyPagesController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly mapper: LegacyCommerceMapper,
  ) {}

  @Get()
  async page(@Query("code") code?: string) {
    const [bootstrap, catalog] = await Promise.all([
      this.commerce.publicGet(
        `/storefront/bootstrap${code ? `?code=${encodeURIComponent(code)}` : ""}`,
      ),
      this.commerce.publicGet("/storefront/products?page=1&pageSize=60"),
    ]);
    return legacySuccess(
      await this.mapper.home(
        unwrapCommerce(bootstrap),
        unwrapCommerce(catalog),
      ),
    );
  }
}

@Controller("api/inv-shop/v1/product/product")
@RawResponse()
export class LegacyProductController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly mapper: LegacyCommerceMapper,
  ) {}

  @Get("view")
  async product(@Query("id") id: string) {
    const productId = await this.mapper.productExternalId(id);
    const result = await this.commerce.publicGet(
      `/storefront/products/${encodeURIComponent(productId)}`,
    );
    return legacySuccess(
      await this.mapper.productDetail(unwrapCommerce(result)),
    );
  }
}

@Controller("api/inv-shop/v1")
@RawResponse()
@UseGuards(UserAuthGuard)
@UseInterceptors(NoFilesInterceptor({ limits: { fields: 40, fieldSize: 2 * 1024 * 1024 } }))
export class LegacyOrderController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly mapper: LegacyCommerceMapper,
  ) {}

  @Get("member/order/index")
  async orders(
    @CurrentUser() user: AuthenticatedUser,
    @Query("synthesize_status") status?: string,
  ) {
    const result = await this.commerce.orders(user.id);
    return legacySuccess(await this.mapper.orders(result, status));
  }

  @Get("member/order/view")
  async order(
    @CurrentUser() user: AuthenticatedUser,
    @Query("id") id: string,
  ) {
    const orderId = await this.mapper.orderExternalId(id);
    return legacySuccess(
      await this.mapper.order(await this.commerce.orderDetail(user.id, orderId)),
    );
  }

  @Get("order/order/preview")
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string>,
  ) {
    const cart = query.type === "cart" ? await this.commerce.forUser(user.id, "GET", "/cart") : undefined;
    const normalized = await this.mapper.previewQuery(query, cart);
    const result = await this.commerce.forUser(
      user.id,
      "POST",
      "/orders/preview",
      normalized,
    );
    return legacySuccess(await this.mapper.preview(unwrapCommerce(result)));
  }

  @Post("order/order/create")
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const cart = safeObject(input).type === "cart" ? await this.commerce.forUser(user.id, "GET", "/cart") : undefined;
    const normalized = await this.mapper.orderRequest(input, cart);
    const result = await this.commerce.forUser(
      user.id,
      "POST",
      "/orders",
      normalized,
      idempotencyKey?.trim() || sha256(JSON.stringify(normalized)),
    );
    return legacySuccess(await this.mapper.order(unwrapCommerce(result)));
  }

  @Post("order/order/create-batch")
  createBatchOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createOrder(user, input, idempotencyKey);
  }

  @Post("member/order/take-delivery")
  async receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const id = await this.mapper.orderExternalId(safeObject(input).id);
    const result = await this.commerce.forUser(
      user.id,
      "POST",
      `/orders/${encodeURIComponent(id)}/receipt`,
    );
    return legacySuccess(unwrapCommerce(result), "已确认收货");
  }

  @Post("member/order-product/refund-apply")
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const id = await this.mapper.orderItemExternalId(body.id);
    const result = await this.commerce.forUser(
      user.id,
      "POST",
      `/order-items/${encodeURIComponent(id)}/after-sales`,
      this.mapper.refundRequest(body, id),
    );
    return legacySuccess(unwrapCommerce(result), "售后申请已提交");
  }

  @Get("member/order-product-express/details")
  async express(
    @CurrentUser() user: AuthenticatedUser,
    @Query("order_id") orderId: string,
  ) {
    const id = await this.mapper.orderExternalId(orderId);
    const result = await this.commerce.forUser(
      user.id,
      "GET",
      `/orders/${encodeURIComponent(id)}/logistics`,
    );
    return legacySuccess({
      data: this.mapper.shipments(unwrapCommerce(result)),
    });
  }
}

@Controller("api/inv-shop/v1/member/cart-item")
@RawResponse()
@UseGuards(UserAuthGuard)
@UseInterceptors(NoFilesInterceptor({ limits: { fields: 10, fieldSize: 16 * 1024 } }))
export class LegacyCartController {
  constructor(private readonly commerce: CommerceService, private readonly mapper: LegacyCommerceMapper) {}

  @Get("index")
  async index(@CurrentUser() user: AuthenticatedUser) {
    return legacySuccess(await this.mapper.cart(await this.commerce.forUser(user.id, "GET", "/cart")));
  }

  @Post("create")
  async create(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const body = await this.mapper.cartMutation(input);
    const cart = await this.commerce.forUser(user.id, "POST", "/cart/items", { ...body, mode: "increment" });
    return legacySuccess(await this.mapper.cart(cart));
  }

  @Post("update-num")
  async updateNumber(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const body = await this.mapper.cartMutation(input);
    const cart = safeObject(await this.commerce.forUser(user.id, "GET", "/cart"));
    if (!Array.isArray(cart.items) || !cart.items.some((row) => safeObject(row).skuId === body.skuId)) {
      throw new NotFoundException("购物车商品不存在");
    }
    const updated = await this.commerce.forUser(user.id, "POST", "/cart/items", { ...body, mode: "set" });
    return legacySuccess(await this.mapper.cart(updated));
  }

  @Post("delete-ids")
  async deleteIds(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const cart = await this.commerce.forUser(user.id, "GET", "/cart");
    const ids = await this.mapper.cartDeletionIds(input, cart);
    for (const id of ids) await this.commerce.forUser(user.id, "DELETE", `/cart/items/${encodeURIComponent(id)}`);
    return this.index(user);
  }
}

@Controller("api/v1/member/address")
@RawResponse()
@UseGuards(UserAuthGuard)
@UseInterceptors(NoFilesInterceptor({ limits: { fields: 40, fieldSize: 2 * 1024 * 1024 } }))
export class LegacyAddressController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly mapper: LegacyCommerceMapper,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.commerce.forUser(user.id, "GET", "/addresses");
    return legacySuccess(await this.mapper.addresses(unwrapCommerce(result)));
  }

  @Get(":id")
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const addressId = await this.mapper.addressExternalId(id);
    const result = await this.commerce.forUser(
      user.id,
      "GET",
      `/addresses/${encodeURIComponent(addressId)}`,
    );
    return legacySuccess(await this.mapper.address(unwrapCommerce(result)));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const result = await this.commerce.forUser(
      user.id,
      "POST",
      "/addresses",
      input,
    );
    return legacySuccess(
      await this.mapper.address(unwrapCommerce(result)),
      "地址已保存",
    );
  }

  @Put(":id")
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const addressId = await this.mapper.addressExternalId(id);
    const result = await this.commerce.forUser(
      user.id,
      "PATCH",
      `/addresses/${encodeURIComponent(addressId)}`,
      input,
    );
    return legacySuccess(
      await this.mapper.address(unwrapCommerce(result)),
      "地址已保存",
    );
  }

  @Delete(":id")
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const addressId = await this.mapper.addressExternalId(id);
    const result = await this.commerce.forUser(
      user.id,
      "DELETE",
      `/addresses/${encodeURIComponent(addressId)}`,
    );
    return legacySuccess(unwrapCommerce(result), "地址已删除");
  }
}

@Controller("api/v1/pay")
@RawResponse()
@UseGuards(UserAuthGuard)
@UseInterceptors(NoFilesInterceptor({ limits: { fields: 30, fieldSize: 2 * 1024 * 1024 } }))
export class LegacyPaymentController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly mapper: LegacyCommerceMapper,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const normalized = await this.mapper.paymentRequest(input);
    const result = await this.commerce.forUser(
      user.id,
      "POST",
      "/payments",
      normalized,
      sha256(JSON.stringify(normalized)),
    );
    return legacySuccess(this.mapper.payment(unwrapCommerce(result)));
  }
}

function unwrapCommerce(value: unknown): unknown {
  const payload = safeObject(value);
  return "data" in payload && "code" in payload ? payload.data : value;
}
