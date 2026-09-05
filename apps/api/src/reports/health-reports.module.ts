import { Module } from "@nestjs/common";
import { HealthReportsController } from "./health-reports.controller";
import { HealthReportsService } from "./health-reports.service";

@Module({
  controllers: [HealthReportsController],
  providers: [HealthReportsService],
  exports: [HealthReportsService],
})
export class HealthReportsModule {}
