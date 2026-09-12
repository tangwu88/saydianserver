import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminModule } from "../admin/admin.module";
import { SupportModule } from "../support/support.module";
import {
  AdminCommerceEvidenceController,
  AppCommerceEvidenceController,
  CommerceEvidenceController,
} from "./commerce-evidence.controller";

@Module({
  imports: [AuthModule, AdminModule, SupportModule],
  controllers: [
    CommerceEvidenceController,
    AppCommerceEvidenceController,
    AdminCommerceEvidenceController,
  ],
})
export class CommerceEvidenceModule {}
