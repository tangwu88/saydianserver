import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { SmsAdapterService } from "./sms-adapter.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, UserAuthGuard, SmsAdapterService],
  exports: [AuthService, UserAuthGuard],
})
export class AuthModule {}
