import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthService } from "./health.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";

@ApiTags("health")
@Controller("api/saydian-app/v2/health")
@UseGuards(UserAuthGuard)
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Post("records/batch")
  ingestBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.health.ingestBatch(user.id, idempotencyKey?.trim() ?? "", body);
  }

  @Get("records")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("metric") metric?: string,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    return this.health.list(user.id, metric, Number(limit ?? 50), before);
  }

  @Get("warning-rules")
  warningRules(@CurrentUser() user: AuthenticatedUser) {
    return this.health.warningRules(user.id);
  }

  @Get("warnings")
  warnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query("limit") limit?: string,
  ) {
    return this.health.warnings(user.id, Number(limit ?? 50));
  }

  @Post("warning-rules")
  saveWarningRules(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.health.saveWarningRules(user.id, body);
  }
}
