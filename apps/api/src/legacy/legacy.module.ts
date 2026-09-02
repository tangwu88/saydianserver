import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CareModule } from "../care/care.module";
import { CommerceModule } from "../commerce/commerce.module";
import { ContentModule } from "../content/content.module";
import { HealthModule } from "../health/health.module";
import { MembersModule } from "../members/members.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SupportModule } from "../support/support.module";
import {
  LegacyAddressController,
  LegacyOrderController,
  LegacyPagesController,
  LegacyPaymentController,
  LegacyProductController,
} from "./legacy-commerce.controller";
import { LegacyContentController } from "./legacy-content.controller";
import { LegacyCommerceMapper } from "./legacy-commerce-mapper.service";
import { LegacyFilesController } from "./legacy-files.controller";
import { LegacyMemberController } from "./legacy-member.controller";
import { LegacySiteController } from "./legacy-site.controller";
import { LegacyService } from "./legacy.service";

@Module({
  imports: [
    AuthModule,
    MembersModule,
    HealthModule,
    CareModule,
    NotificationsModule,
    ContentModule,
    SupportModule,
    CommerceModule,
  ],
  controllers: [
    LegacySiteController,
    LegacyMemberController,
    LegacyContentController,
    LegacyFilesController,
    LegacyPagesController,
    LegacyProductController,
    LegacyOrderController,
    LegacyAddressController,
    LegacyPaymentController,
  ],
  providers: [LegacyService, LegacyCommerceMapper],
})
export class LegacyModule {}
