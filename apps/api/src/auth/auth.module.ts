import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { SmsAdapterService } from "./sms-adapter.service";
import { WechatAppAuthService } from "./wechat-app-auth.service";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    UserAuthGuard,
    SmsAdapterService,
    WechatAppAuthService,
  ],
  exports: [AuthService, UserAuthGuard],
})
export class AuthModule {}
