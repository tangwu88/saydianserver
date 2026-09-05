import { Module } from "@nestjs/common";
import { CommerceController } from "./commerce.controller";
import { CommerceService } from "./commerce.service";
import { CommerceStoreService } from "./commerce-store.service";
import { BillingModule } from "../billing/billing.module";
import { AuthModule } from "../auth/auth.module";
import { CommerceCompatibilityController } from "./commerce-compat.controller";
import { CommerceEmployeeController } from "./commerce-employee.controller";
import { EmployeeAuthGuard } from "./employee-auth.guard";
import { EmployeePromotionService } from "./employee-promotion.service";

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [
    CommerceController,
    CommerceCompatibilityController,
    CommerceEmployeeController,
  ],
  providers: [
    CommerceService,
    CommerceStoreService,
    EmployeePromotionService,
    EmployeeAuthGuard,
  ],
  exports: [CommerceService],
})
export class CommerceModule {}
