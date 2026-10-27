import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";
import {
  GiftController,
  GiftAdminController,
  GiftNoStoreInterceptor,
} from "./gift.controller";
import { GiftService } from "./gift.service";
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [GiftController, GiftAdminController],
  providers: [GiftService, GiftNoStoreInterceptor],
})
export class GiftModule {}
