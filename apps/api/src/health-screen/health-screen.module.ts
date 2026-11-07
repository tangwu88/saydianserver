import { Module } from "@nestjs/common";
import { HealthScreenService } from "./health-screen.service";
import { AuthModule } from "../auth/auth.module";
import { ScreenLoginController,ScreenScanController,OwnHealthScreenController } from "./member-health-screen.controller";
import { MemberScreenLogin,MemberScreenGuard } from "./member-screen-login";
@Module({imports:[AuthModule],controllers:[ScreenLoginController,ScreenScanController,OwnHealthScreenController], providers: [HealthScreenService,MemberScreenLogin,MemberScreenGuard], exports: [HealthScreenService] })
export class HealthScreenModule {}
