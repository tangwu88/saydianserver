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
import {
  CurrentPartner,
  type RequestWithContext,
} from "../common/request-context";
import { PartnerAuthGuard } from "./partner-auth";
import { HealthScreenService } from "../health-screen/health-screen.service";
type Partner = { id: string };
@ApiTags("partner-health-screen")
@Controller("api/saydian-app/vip/v1")
@UseGuards(PartnerAuthGuard)
export class PartnerHealthScreenController {
  constructor(private readonly service: HealthScreenService) {}
  @Get("health-analysis/availability")
  @Header("Cache-Control", "no-store")
  availability(@CurrentPartner() p: Partner) {
    return this.service.entry({ type: "PARTNER", id: p.id });
  }
  @Get("members/:memberId/health-analysis/profile")
  @Header("Cache-Control", "no-store")
  profile(
    @Param("memberId") id: string,
    @CurrentPartner() a: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.profileGate(
      id,
      { type: "PARTNER", id: a.id },
      r.requestId,
    );
  }
  @Get("members/:memberId/health-analysis")
  @Header("Cache-Control", "no-store")
  load(
    @Param("memberId") id: string,
    @Query("days") days: string,
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.load(
      id,
      days,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
  @Get("members/:memberId/health-analysis/updates")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  updates(
    @Param("memberId") id: string,
    @Query("days") days: string,
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.updates(
      id,
      days,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
  @Get("members/:memberId/health-analysis/references")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  references(
    @Param("memberId") id: string,
    @Query("cursor") cursor: string,
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.references(
      id,
      cursor,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
  @Post("members/:memberId/health-analysis/references")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  saveReference(
    @Param("memberId") id: string,
    @Body() body: unknown,
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.saveReference(
      id,
      body,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
  @Post("members/:memberId/health-analysis/references/:referenceId/void")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  voidReference(
    @Param("memberId") id: string,
    @Param("referenceId") referenceId: string,
    @Body() body: unknown,
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.voidReference(
      id,
      referenceId,
      body,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
  @Get("members/:memberId/health-analysis/records")
  @Header("Cache-Control", "no-store")
  records(
    @Param("memberId") id: string,
    @Query() query: { days?: string; metric?: string; cursor?: string },
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.records(
      id,
      query,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
  @Post("members/:memberId/health-analysis/analyses")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  generate(
    @Param("memberId") id: string,
    @Body() body: unknown,
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.generate(
      id,
      body,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
  @Get("members/:memberId/health-analysis/analyses/:id")
  @Header("Cache-Control", "no-store")
  result(
    @Param("memberId") memberId: string,
    @Param("id") id: string,
    @CurrentPartner() p: Partner,
    @Req() r: RequestWithContext,
  ) {
    return this.service.result(
      memberId,
      id,
      { type: "PARTNER", id: p.id },
      r.requestId,
    );
  }
}
