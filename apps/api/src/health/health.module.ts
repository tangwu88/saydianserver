import { CnCycleController } from "../cycle/cn-cycle.controller";
import { CnCycleService } from "../cycle/cn-cycle.service";
import { CycleController } from "../cycle/cycle.controller";
import { CycleService } from "../cycle/cycle.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { SupportModule } from "../support/support.module";
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [SupportModule],
  controllers: [HealthController, CycleController, CnCycleController],
  providers: [
    HealthService,
    CycleService,
    CnCycleService,
    IntegrationSecretsService,
  ],
  exports: [HealthService],
})
export class HealthModule {}
