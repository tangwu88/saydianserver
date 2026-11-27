import { Module } from "@nestjs/common";
import { RingEngagementAdminController, RingExperienceController, RingFirmwareAdminController } from "./ring-experience.controller";
import { RingExperienceService } from "./ring-experience.service";
import { RingFirmware } from "./ring-firmware";
import { CnRingWebController, RingWebController } from "./ring-web.controller";

@Module({
  controllers: [RingEngagementAdminController, RingExperienceController, RingFirmwareAdminController, RingWebController, CnRingWebController],
  providers: [RingExperienceService, RingFirmware],
})
export class RingExperienceModule {}
