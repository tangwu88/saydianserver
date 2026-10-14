import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AdminRole } from "@prisma/client";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { UserAuthGuard } from "../common/user-auth.guard";
import { RawResponse } from "../common/raw-response.decorator";
import {
  CurrentAdmin,
  CurrentPartner,
  CurrentUser,
  RequestWithContext,
} from "../common/request-context";
import { PartnerAuthGuard } from "./partner-auth";
import { PartnerOnboardingService } from "./partner-onboarding.service";
import { PartnerAgreementService } from "./partner-agreement.service";

@ApiTags("brand-partner-member")
@Controller("api/saidian-mall/v1/partner")
@UseGuards(UserAuthGuard)
@RawResponse()
export class PartnerMemberController {
  constructor(private readonly onboarding: PartnerOnboardingService) {}
  @Get("status")
  status(@CurrentUser() member: { id: string }) {
    return this.onboarding.memberStatus(member.id);
  }
  @Post("applications")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  apply(
    @CurrentUser() member: { id: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.onboarding.apply(member.id, body, request.requestId);
  }
  @Post("login-ticket")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  ticket(
    @CurrentUser() member: { id: string; sessionId: string },
    @Body() body: unknown,
  ) {
    return this.onboarding.loginTicket(member.id, member.sessionId, body);
  }
}

@ApiTags("brand-partner-auth")
@Controller("api/saydian-app/vip/v1/auth")
export class PartnerMemberLoginController {
  constructor(private readonly onboarding: PartnerOnboardingService) {}
  @Post("member-login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: unknown) {
    return this.onboarding.redeemTicket(body);
  }
}

@ApiTags("brand-partner-agreement")
@Controller("api/saydian-app/vip/v1/agreement")
@UseGuards(PartnerAuthGuard)
export class PartnerAgreementController {
  constructor(private readonly agreements: PartnerAgreementService) {}
  @Get()
  current(
    @CurrentPartner() partner: { id: string; sessionId: string },
    @Req() request: RequestWithContext,
  ) {
    return this.agreements.current(
      partner.id,
      partner.sessionId,
      request.ip,
      request.header("user-agent"),
    );
  }
  @Post("accept")
  accept(
    @CurrentPartner() partner: { id: string; sessionId: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.agreements.accept(
      partner.id,
      partner.sessionId,
      body,
      request.requestId,
      request.ip,
      request.header("user-agent"),
    );
  }
}

@ApiTags("admin-brand-partner-onboarding")
@Controller("api/saydian-app/admin/v1")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN)
export class PartnerOnboardingAdminController {
  constructor(
    private readonly onboarding: PartnerOnboardingService,
    private readonly agreements: PartnerAgreementService,
  ) {}
  @Get("partner-applications")
  list(@Query("status") status = "", @Query("page") page?: string) {
    return this.onboarding.applications(status, page);
  }
  @Post("partner-applications/:id/review")
  review(
    @CurrentAdmin() admin: { id: string },
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.onboarding.review(admin.id, id, body, request.requestId);
  }
  @Post("partners/:id/link-member")
  link(
    @CurrentAdmin() admin: { id: string },
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.onboarding.linkMember(admin.id, id, body, request.requestId);
  }
  @Get("partner-agreements")
  agreementsList() {
    return this.agreements.list();
  }
  @Post("partner-agreements/draft")
  draft(
    @CurrentAdmin() admin: { id: string },
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.agreements.draft(admin.id, body, request.requestId);
  }
  @Post("partner-agreements/:id/publish")
  publish(
    @CurrentAdmin() admin: { id: string },
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ) {
    return this.agreements.publish(admin.id, id, body, request.requestId);
  }
  @Get("partner-agreements/:id/acceptances")
  acceptances(@Param("id") id: string) {
    return this.agreements.acceptances(id);
  }
}
