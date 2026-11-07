import { Module } from "@nestjs/common";
import { MiniShareService } from './mini-share.service';
import { CommerceController } from "./commerce.controller";
import { CommerceService } from "./commerce.service";
import { CommerceStoreService } from "./commerce-store.service";
import { BillingModule } from "../billing/billing.module";
import { AuthModule } from "../auth/auth.module";
import { CommerceCompatibilityController } from "./commerce-compat.controller";
import { CommerceEmployeeController } from "./commerce-employee.controller";
import { EmployeeAuthGuard } from "./employee-auth.guard";
import { EmployeePromotionService } from "./employee-promotion.service";
import { CommerceCapabilitiesService } from "./commerce-capabilities.service";
import { CommerceWithdrawalService } from "./commerce-withdrawal.service";
import { SupportModule } from "../support/support.module";
import { MembersModule } from "../members/members.module";
import { CommerceMemberProfileController } from "./commerce-member-profile.controller";

@Module({
  imports: [AuthModule, BillingModule, SupportModule, MembersModule],
  controllers: [
    CommerceController,
    CommerceCompatibilityController,
    CommerceEmployeeController,
    CommerceMemberProfileController,
  ],
  providers: [
    MiniShareService,
    CommerceService,
    CommerceStoreService,
    EmployeePromotionService,
    CommerceWithdrawalService,
    EmployeeAuthGuard,
    CommerceCapabilitiesService,
  ],
  exports: [CommerceService],
})
export class CommerceModule {}
