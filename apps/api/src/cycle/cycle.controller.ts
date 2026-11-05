import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Header,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { ApiTags } from "@nestjs/swagger";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, AuthenticatedUser } from "../common/request-context";
import { CycleService } from "./cycle.service";
@ApiTags("cycle")
@Controller("api/saydian-app/v2/health/cycle")
@UseGuards(UserAuthGuard)
export class CycleController {
  constructor(private readonly cycle: CycleService) {}
  private scoped(u: AuthenticatedUser, owner: unknown) {
    const expected = createHash("sha256")
      .update("saydian-health-owner:member:" + u.id)
      .digest("hex");
    if (owner !== expected)
      throw new ConflictException("账号已变化，请重新打开周期页面");
  }

  @Get("changes") @Header("Cache-Control", "no-store") changes(
    @CurrentUser() u: AuthenticatedUser,
    @Query("owner") owner: string,
    @Query("cursor") cursor?: string,
    @Query("schemaVersion") schema?: string,
  ) {
    this.scoped(u, owner);
    return this.cycle.changes(u.id, Number(cursor ?? 0), schema === "2");
  }
  @Post("sync") sync(
    @CurrentUser() u: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    this.scoped(u, (body as { ownerHash?: unknown })?.ownerHash);
    return this.cycle.sync(u.id, body);
  }
  @Get("prediction") @Header("Cache-Control", "no-store") prediction(
    @CurrentUser() u: AuthenticatedUser,
    @Query("owner") owner: string,
    @Query("offsetMinutes") offset?: string,
  ) {
    this.scoped(u, owner);
    return this.cycle.forecast(u.id, offset);
  }
  @Get("ai-availability") @Header("Cache-Control", "no-store") availability(
    @CurrentUser() u: AuthenticatedUser,
    @Query("owner") owner: string,
  ) {
    this.scoped(u, owner);
    return this.cycle.aiAvailability(u.id);
  }
  @Post("analysis-consent") consent(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: unknown,
  ) {
    this.scoped(u, (b as { ownerHash?: unknown })?.ownerHash);
    return this.cycle.consent(u.id, b);
  }
  @Post("explanation") explain(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { offsetMinutes?: number; ownerHash?: string },
  ) {
    this.scoped(u, b?.ownerHash);
    return this.cycle.explain(u.id, b?.offsetMinutes);
  }
  @Get("night-features") @Header("Cache-Control", "no-store") nightFeatures(
    @CurrentUser() u: AuthenticatedUser,
    @Query("owner") owner: string,
  ) {
    this.scoped(u, owner);
    return this.cycle.nightFeatures(u.id);
  }
  @Post("erase") erase(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { confirmed?: boolean; ownerHash?: string },
  ) {
    this.scoped(u, b?.ownerHash);
    if (b?.confirmed !== true) throw new BadRequestException("请确认删除");
    return this.cycle.erase(u.id);
  }
}
