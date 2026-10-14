import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { BillingModule } from "../billing/billing.module";
import { SupportModule } from "../support/support.module";
import { PartnerAuthGuard, PartnerAuthService } from "./partner-auth";
import {
  PartnerPublicController,
  PartnerController,
} from "./partner.controller";
import { PartnerService } from "./partner.service";
import { PartnerCommerceService } from "./partner-commerce.service";
import { PartnerMembersService } from "./partner-members.service";
import { PartnerAdminController } from "./partner-admin.controller";
import { PartnerAdminService } from "./partner-admin.service";
import { AuthModule } from "../auth/auth.module";
import { PartnerOnboardingService } from "./partner-onboarding.service";
import { PartnerAgreementService } from "./partner-agreement.service";
import { PartnerMemberController, PartnerMemberLoginController, PartnerAgreementController, PartnerOnboardingAdminController } from "./partner-onboarding.controller";

@Module({
  imports: [AdminModule, BillingModule, SupportModule, AuthModule],
  controllers: [
    PartnerPublicController,
    PartnerController,
    PartnerAdminController,
    PartnerMemberController, PartnerMemberLoginController, PartnerAgreementController, PartnerOnboardingAdminController,
  ],
  providers: [
    PartnerAuthGuard,
    PartnerAuthService,
    PartnerService,
    PartnerCommerceService,
    PartnerMembersService,
    PartnerAdminService,
    PartnerOnboardingService, PartnerAgreementService,
  ],
})
export class PartnerModule {}
