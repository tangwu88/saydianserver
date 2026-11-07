import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AdminRole } from "@prisma/client";
import {
  CurrentAdmin,
  type RequestWithContext,
} from "../common/request-context";
import { AdminAuthGuard, AdminRoles } from "./admin-auth";
import { HealthScreenService } from "../health-screen/health-screen.service";
type Admin = { id: string };
@ApiTags("member-health-screen")
@Controller("api/saydian-app/admin/v1/member-health-analysis")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.HEALTH_AUDITOR)
export class AdminHealthScreenController {
  constructor(private readonly service: HealthScreenService) {}
  @Get("availability")
  @Header("Cache-Control", "no-store")
  availability(@CurrentAdmin() a: Admin) {
    return this.service.entry({ type: "ADMIN", id: a.id });
  }
  @Get(":memberId/profile")
  @Header("Cache-Control", "no-store")
  profile(
    @Param("memberId") id: string,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.profileGate(
      id,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Post(":memberId/profile")
  @Header("Cache-Control", "no-store")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  completeProfile(
    @Param("memberId") id: string,
    @Body() input: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.completeProfile(
      id,
      input,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Get(":memberId")
  @Header("Cache-Control", "no-store")
  load(
    @Param("memberId") id: string,
    @Query("days") days: string,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.load(
      id,
      days,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Get(":memberId/updates")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  updates(
    @Param("memberId") id: string,
    @Query("days") days: string,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.updates(
      id,
      days,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Get(":memberId/references")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  references(
    @Param("memberId") id: string,
    @Query("cursor") cursor: string,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.references(
      id,
      cursor,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Post(":memberId/references")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  saveReference(
    @Param("memberId") id: string,
    @Body() body: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.saveReference(
      id,
      body,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Post(":memberId/references/:referenceId/void")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  voidReference(
    @Param("memberId") id: string,
    @Param("referenceId") referenceId: string,
    @Body() body: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.voidReference(
      id,
      referenceId,
      body,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Get(":memberId/records")
  @Header("Cache-Control", "no-store")
  records(
    @Param("memberId") id: string,
    @Query()
    query: { days?: string; metric?: string; cursor?: string; reason?: string },
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.records(
      id,
      query,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Post(":memberId/analyses")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  generate(
    @Param("memberId") id: string,
    @Body() body: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.generate(
      id,
      body,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Get(":memberId/analyses/:id")
  @Header("Cache-Control", "no-store")
  result(
    @Param("memberId") memberId: string,
    @Param("id") id: string,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.result(
      memberId,
      id,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
}
@ApiTags("health-score-rules")
@Controller("api/saydian-app/admin/v1/health-score-rules")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.HEALTH_AUDITOR)
export class HealthScoreRulesController {
  constructor(private readonly service: HealthScreenService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentAdmin() a: Admin) {
    return this.service.rules({ type: "ADMIN", id: a.id });
  }
  @Post()
  @AdminRoles(AdminRole.SUPER_ADMIN)
  save(
    @Body() body: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.saveRules(
      body,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Post("settings")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  settings(
    @Body() body: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.settings(
      body,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Post(":id/publish")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  publish(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.publish(
      id,
      body,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
  @Post(":id/preview")
  @Header("Cache-Control", "no-store")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  preview(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentAdmin() a: Admin,
    @Req() r: RequestWithContext,
  ) {
    return this.service.preview(
      id,
      body,
      { type: "ADMIN", id: a.id },
      r.requestId,
    );
  }
}
