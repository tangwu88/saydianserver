import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { ApiDocumentationController } from "./api-documentation.controller";
import { ApiDocumentationService } from "./api-documentation.service";

@Module({
  imports: [AdminModule],
  controllers: [ApiDocumentationController],
  providers: [ApiDocumentationService],
})
export class ApiDocumentationModule {}
