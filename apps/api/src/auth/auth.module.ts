import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { SmsAdapterService } from "./sms-adapter.service";
import { WechatAppAuthService } from "./wechat-app-auth.service";
import { WechatH5AuthService } from "./wechat-h5-auth.service";
import { GlobalAuthService } from "./global-auth.service";
import { GlobalVerificationDeliveryService } from "./global-verification-delivery.service";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    GlobalAuthService,
    GlobalVerificationDeliveryService,
    UserAuthGuard,
    SmsAdapterService,
    WechatAppAuthService,
    WechatH5AuthService,
  ],
  exports: [AuthService, UserAuthGuard, WechatH5AuthService],
})
export class AuthModule {}
