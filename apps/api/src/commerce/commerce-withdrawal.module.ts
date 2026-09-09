import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { CommerceWithdrawalService } from "./commerce-withdrawal.service";
import { CommerceAdminWithdrawalController, CommerceEmployeeWithdrawalController } from "./commerce-withdrawal.controller";
import { EmployeeAuthGuard } from "./employee-auth.guard";

@Module({ imports: [AdminModule], controllers: [CommerceAdminWithdrawalController, CommerceEmployeeWithdrawalController],
  providers: [CommerceWithdrawalService, EmployeeAuthGuard] })
export class CommerceWithdrawalModule {}
