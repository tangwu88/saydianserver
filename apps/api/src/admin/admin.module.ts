import { HealthScreenModule } from "../health-screen/health-screen.module";
import { JushuitanRenewalController } from "./jushuitan-renewal.controller";
import { AdminHealthScreenController, HealthScoreRulesController } from "./admin-health-screen.controller";
import { Module } from "@nestjs/common";
import { AdminController, AdminLoginController } from "./admin.controller";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";
import { AdminAuthGuard, AdminAuthService } from "./admin-auth";
import { AdminService } from "./admin.service";
import { HealthReportsModule } from "../reports/health-reports.module";
import { AdminHealthReportsController } from "./admin-health-reports.controller";
import { AdminHealthReportsService } from "./admin-health-reports.service";
import { SupportModule } from "../support/support.module";
import { AuthModule } from "../auth/auth.module";
import { AdminEmailDeliveryController } from "./admin-email-delivery.controller";

@Module({
  imports: [HealthScreenModule, HealthReportsModule, SupportModule, AuthModule],
  controllers: [JushuitanRenewalController, AdminHealthScreenController, HealthScoreRulesController, AdminLoginController, AdminController, AdminHealthReportsController, AdminEmailDeliveryController],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AdminAuditInterceptor,
    AdminService,
    AdminHealthReportsService,
  ],
  exports: [AdminAuthGuard, AdminAuditInterceptor],
})
export class AdminModule {}
