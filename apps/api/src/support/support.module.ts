import { Module } from "@nestjs/common";
import { FilesController, SupportController } from "./support.controller";
import { SupportService } from "./support.service";

@Module({
  controllers: [SupportController, FilesController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
