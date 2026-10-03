import { SupportModule } from "../support/support.module";
import { Module } from "@nestjs/common";
import { CareController } from "./care.controller";
import { CareService } from "./care.service";

@Module({
  imports: [SupportModule],
  controllers: [CareController],
  providers: [CareService],
  exports: [CareService],
})
export class CareModule {}
