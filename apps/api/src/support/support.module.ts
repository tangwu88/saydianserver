import { Module } from "@nestjs/common";
import { FilesController, SupportController } from "./support.controller";
import { SupportService } from "./support.service";
import { WeatherForecastService } from "./weather-forecast.service";
import { AuthModule } from "../auth/auth.module";
import { OnlineSupportController, SupportAccessGuard } from "./online-support.controller";
import { SupportAi } from "./support-ai";
import { SupportContent } from "./support-content";
import { SupportConversations } from "./support-conversations";

@Module({
  imports: [AuthModule],
  controllers: [SupportController, FilesController, OnlineSupportController],
  providers: [SupportService, WeatherForecastService, SupportContent, SupportConversations, SupportAi, SupportAccessGuard],
  exports: [SupportService, SupportContent, SupportConversations],
})
export class SupportModule {}
