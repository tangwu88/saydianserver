import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { RawResponse } from "../common/raw-response.decorator";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentPartner, RequestWithContext } from "../common/request-context";
import { PartnerAuthGuard, PartnerAuthService } from "./partner-auth";
import { PartnerService } from "./partner.service";
import { PartnerCommerceService } from "./partner-commerce.service";
import { PartnerMembersService } from "./partner-members.service";

type Partner = { id: string; sessionId: string };

@ApiTags("brand-partner-auth")
@Controller("api/saydian-app/vip/v1")
export class PartnerPublicController {
  constructor(
    private readonly auth: PartnerAuthService,
    private readonly partners: PartnerService,
  ) {}
  @Post("auth/login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: unknown) {
    return this.auth.login(body);
  }
  @Get("public/certificate/:code")
  certificate(@Param("code") code: string) {
    return this.partners.publicCertificate(code);
  }
  @Get("public/promotion/:code")
  promotion(@Param("code") code: string) {
    return this.partners.publicPromotion(code);
  }
}

@ApiTags("brand-partner")
@Controller("api/saydian-app/vip/v1")
@UseGuards(PartnerAuthGuard)
export class PartnerController {
  constructor(
    private readonly auth: PartnerAuthService,
    private readonly partners: PartnerService,
    private readonly commerce: PartnerCommerceService,
    private readonly membersService: PartnerMembersService,
  ) {}

  @Get("auth/me")
  async me(@CurrentPartner() partner: Partner) {
    const profile = await this.partners.me(partner.id);
    const { wallet: _wallet, ...identity } = profile;
    return identity;
  }
  @Post("auth/logout")
  logout(@CurrentPartner() partner: Partner) {
    return this.auth.logout(partner.sessionId);
  }
  @Get("dashboard")
  dashboard(@CurrentPartner() partner: Partner) {
    return this.partners.overview(partner.id);
  }
  @Get("promotion")
  promotion(@CurrentPartner() partner: Partner) {
    return this.partners.promotion(partner.id);
  }
  @Get("certificate")
  certificate(@CurrentPartner() partner: Partner) {
    return this.partners.certificate(partner.id);
  }
  @Get("members")
  members(
    @CurrentPartner() partner: Partner,
    @Query("search") search = "",
    @Query("page") page?: string,
  ) {
    return this.membersService.members(partner.id, search, page);
  }
  @Get("members/:id/profile")
  profile(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.membersService.profile(partner.id, id, request.requestId);
  }
  @Get("members/:id/health-summary")
  healthSummary(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.membersService.healthSummary(partner.id, id, request.requestId);
  }
  @Get("members/:id/health-records")
  healthRecords(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.membersService.healthRecords(
      partner.id,
      id,
      request.requestId,
      page,
      pageSize,
    );
  }
  @Get("members/:id/devices")
  devices(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.membersService.devices(partner.id, id, request.requestId);
  }
  @Get("members/:id/reports")
  reports(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Query("page") page?: string,
  ) {
    return this.membersService.reports(partner.id, id, request.requestId, page);
  }
  @Get("reports/:id")
  report(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.membersService.report(partner.id, id, request.requestId);
  }
  @Get("health-records/:id/ecg")
  @RawResponse()
  async ecg(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Res() response: Response,
  ) {
    const file = await this.membersService.ecg(
      partner.id,
      id,
      request.requestId,
    );
    response.setHeader("content-type", "application/gzip");
    response.setHeader("content-length", String(file.byteSize));
    response.setHeader("cache-control", "no-store");
    response.setHeader(
      "content-disposition",
      `attachment; filename="ecg-${id}.gz"`,
    );
    response.setHeader("x-content-sha256", file.sha256);
    response.setHeader("x-ecg-sample-rate", String(file.sampleRateHz));
    response.setHeader("x-ecg-sample-count", String(file.sampleCount));
    file.body.once("error", () => response.destroy());
    file.body.pipe(response);
  }
  @Get("devices/:id/connections")
  connections(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Query("page") page?: string,
  ) {
    return this.membersService.connections(
      partner.id,
      id,
      request.requestId,
      page,
    );
  }
  @Get("devices/:id/measurements")
  measurements(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.membersService.measurements(
      partner.id,
      id,
      request.requestId,
      page,
      pageSize,
    );
  }
  @Get("products")
  products(
    @CurrentPartner() partner: Partner,
    @Query("search") search = "",
    @Query("page") page?: string,
  ) {
    return this.commerce.products(partner.id, search, page);
  }
  @Post("quote")
  quote(@CurrentPartner() partner: Partner, @Body() body: unknown) {
    return this.commerce.quote(partner.id, body);
  }
  @Post("orders")
  createOrder(@CurrentPartner() partner: Partner, @Body() body: unknown) {
    return this.commerce.createOrder(partner.id, body);
  }
  @Get("orders")
  orders(@CurrentPartner() partner: Partner, @Query("page") page?: string) {
    return this.commerce.orders(partner.id, page);
  }
  @Get("orders/:id")
  order(@CurrentPartner() partner: Partner, @Param("id") id: string) {
    return this.commerce.order(partner.id, id);
  }
  @Get("orders/:id/processing")
  processing(@CurrentPartner() partner: Partner, @Param("id") id: string) {
    return this.commerce.processing(partner.id, id);
  }
  @Get("orders/:id/logistics")
  logistics(@CurrentPartner() partner: Partner, @Param("id") id: string) {
    return this.commerce.logistics(partner.id, id);
  }
  @Get("wallet")
  wallet(@CurrentPartner() partner: Partner) {
    return this.partners.wallet(partner.id);
  }
  @Get("ledger")
  ledger(
    @CurrentPartner() partner: Partner,
    @Query("account") account = "",
    @Query("page") page?: string,
  ) {
    return this.partners.ledger(partner.id, account, page);
  }
  @Get("payment-capabilities")
  paymentCapabilities(@CurrentPartner() partner: Partner) {
    return this.partners.paymentCapabilities(partner.id);
  }
  @Post("recharges")
  createRecharge(
    @CurrentPartner() partner: Partner,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.partners.createRecharge(partner.id, body, request.ip, request.header("user-agent"));
  }
  @Get("recharges")
  recharges(@CurrentPartner() partner: Partner, @Query("page") page?: string) {
    return this.partners.recharges(partner.id, page);
  }
  @Get("recharges/:id")
  recharge(@CurrentPartner() partner: Partner, @Param("id") id: string) {
    return this.partners.recharge(partner.id, id);
  }
  @Post("recharges/:id/payment")
  rechargePayment(
    @CurrentPartner() partner: Partner,
    @Param("id") id: string,
    @Req() request: RequestWithContext,
  ) {
    return this.partners.rechargePayment(partner.id, id, request.ip);
  }
}
