import { Module } from "@nestjs/common";
import { AiController, ContentController } from "./content.controller";
import { ContentService } from "./content.service";

@Module({
  controllers: [ContentController, AiController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
