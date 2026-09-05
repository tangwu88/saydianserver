import { Module } from "@nestjs/common";
import { AdminController, AdminLoginController } from "./admin.controller";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";
import { AdminAuthGuard, AdminAuthService } from "./admin-auth";
import { AdminService } from "./admin.service";

@Module({
  controllers: [AdminLoginController, AdminController],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AdminAuditInterceptor,
    AdminService,
  ],
  exports: [AdminAuthGuard, AdminAuditInterceptor],
})
export class AdminModule {}
