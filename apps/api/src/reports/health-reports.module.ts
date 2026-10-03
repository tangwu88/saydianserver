import { Module } from "@nestjs/common";
import { HealthReportsController } from "./health-reports.controller";
import { HealthReportsService } from "./health-reports.service";
import { SleepReportsService } from "./sleep-reports.service";

@Module({
  controllers: [HealthReportsController],
  providers: [HealthReportsService, SleepReportsService],
  exports: [HealthReportsService, SleepReportsService],
})
export class HealthReportsModule {}
