import { Body, Controller, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import { GlobalVerificationDeliveryService } from "../auth/global-verification-delivery.service";
import { safeObject } from "../common/crypto";
import { AdminAuthGuard, AdminRoles } from "./admin-auth";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";

@ApiTags("admin")
@Controller("api/saydian-app/admin/v1/integrations/email_otp")
@UseGuards(AdminAuthGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminEmailDeliveryController {
  constructor(private readonly delivery: GlobalVerificationDeliveryService) {}

  @Post("test")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.INTEGRATION_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  test(@Body() input: unknown) {
    return this.delivery.sendEmailTest(safeObject(input).recipient);
  }
}
