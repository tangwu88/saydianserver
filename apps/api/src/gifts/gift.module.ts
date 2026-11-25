import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";
import {
  GiftController,
  GiftAdminController,
  GiftNoStoreInterceptor,
} from "./gift.controller";
import { GiftService } from "./gift.service";
import { GiftQueryService } from "./gift-query.service";
import {
  GiftQueryAdminController,
  GiftQueryAuthGuard,
  GiftQueryController,
} from "./gift-query.controller";
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [
    GiftController,
    GiftAdminController,
    GiftQueryController,
    GiftQueryAdminController,
  ],
  providers: [
    GiftService,
    GiftNoStoreInterceptor,
    GiftQueryService,
    GiftQueryAuthGuard,
  ],
})
export class GiftModule {}
