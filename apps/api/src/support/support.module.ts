import { Module } from "@nestjs/common";
import { FilesController, SupportController } from "./support.controller";
import { SupportService } from "./support.service";
import { WeatherForecastService } from "./weather-forecast.service";

@Module({
  controllers: [SupportController, FilesController],
  providers: [SupportService, WeatherForecastService],
  exports: [SupportService],
})
export class SupportModule {}
