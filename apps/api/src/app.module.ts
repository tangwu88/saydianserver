import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module";
import { ApiDocumentationModule } from "./api-docs/api-documentation.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { CareModule } from "./care/care.module";
import { CommerceModule } from "./commerce/commerce.module";
import { CommerceWithdrawalModule } from "./commerce/commerce-withdrawal.module";
import { DatabaseModule } from "./common/database.module";
import { MaintenanceMiddleware } from "./common/maintenance.middleware";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { ContentModule } from "./content/content.module";
import { DevicesModule } from "./devices/devices.module";
import { HealthModule } from "./health/health.module";
import { HealthReportsModule } from "./reports/health-reports.module";
import { LegacyModule } from "./legacy/legacy.module";
import { MembersModule } from "./members/members.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { StatusController } from "./status.controller";
import { SupportModule } from "./support/support.module";

@Module({
  imports: [
    DatabaseModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 180 }]),
    AuthModule,
    BillingModule,
    MembersModule,
    HealthModule,
    HealthReportsModule,
    DevicesModule,
    CareModule,
    NotificationsModule,
    ContentModule,
    SupportModule,
    CommerceModule,
    CommerceWithdrawalModule,
    AdminModule,
    ApiDocumentationModule,
    LegacyModule,
  ],
  controllers: [StatusController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, MaintenanceMiddleware)
      .forRoutes("*");
  }
}
