import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { BillingAdminController, BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { PaymentProviderService } from "./payment-provider.service";
import { AppleIapService } from "./apple-iap.service";

@Module({
  imports: [AdminModule],
  controllers: [BillingController, BillingAdminController],
  providers: [BillingService, PaymentProviderService, AppleIapService],
  exports: [BillingService],
})
export class BillingModule {}
