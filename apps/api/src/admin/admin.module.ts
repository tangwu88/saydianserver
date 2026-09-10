import { Module } from "@nestjs/common";
import { AdminController, AdminLoginController } from "./admin.controller";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";
import { AdminAuthGuard, AdminAuthService } from "./admin-auth";
import { AdminService } from "./admin.service";
import { HealthReportsModule } from "../reports/health-reports.module";
import { AdminHealthReportsController } from "./admin-health-reports.controller";
import { AdminHealthReportsService } from "./admin-health-reports.service";

@Module({
  imports: [HealthReportsModule],
  controllers: [AdminLoginController, AdminController, AdminHealthReportsController],
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
