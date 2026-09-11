import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminModule } from "../admin/admin.module";
import { SupportModule } from "../support/support.module";
import { AdminCommerceEvidenceController, CommerceEvidenceController } from "./commerce-evidence.controller";

@Module({ imports: [AuthModule, AdminModule, SupportModule], controllers: [CommerceEvidenceController, AdminCommerceEvidenceController] })
export class CommerceEvidenceModule {}
