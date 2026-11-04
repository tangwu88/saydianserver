import { CycleController } from "../cycle/cycle.controller";
import { CycleService } from "../cycle/cycle.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { SupportModule } from "../support/support.module";
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [SupportModule],
  controllers: [HealthController, CycleController],
  providers: [HealthService, CycleService, IntegrationSecretsService],
  exports: [HealthService],
})
export class HealthModule {}
