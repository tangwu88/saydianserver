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

@Module({
  imports: [AdminModule, BillingModule, SupportModule],
  controllers: [
    PartnerPublicController,
    PartnerController,
    PartnerAdminController,
  ],
  providers: [
    PartnerAuthGuard,
    PartnerAuthService,
    PartnerService,
    PartnerCommerceService,
    PartnerMembersService,
    PartnerAdminService,
  ],
})
export class PartnerModule {}
