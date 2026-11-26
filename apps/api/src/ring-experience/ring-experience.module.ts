import { Module } from "@nestjs/common";
import { RingEngagementAdminController, RingExperienceController, RingFirmwareAdminController } from "./ring-experience.controller";
import { RingExperienceService } from "./ring-experience.service";
import { RingFirmware } from "./ring-firmware";
import { RingWebController } from "./ring-web.controller";

@Module({
  controllers: [RingEngagementAdminController, RingExperienceController, RingFirmwareAdminController, RingWebController],
  providers: [RingExperienceService, RingFirmware],
})
export class RingExperienceModule {}
