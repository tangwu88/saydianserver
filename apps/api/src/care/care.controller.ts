import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CareService } from "./care.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import {
  CurrentUser,
  type AuthenticatedUser,
  type RequestWithContext,
} from "../common/request-context";
import { safeObject } from "../common/crypto";

@ApiTags("care")
@Controller("api/saydian-app/v2/care")
@UseGuards(UserAuthGuard)
export class CareController {
  constructor(private readonly care: CareService) {}

  @Get("relationships")
  relationships(@CurrentUser() user: AuthenticatedUser) {
    return this.care.relationships(user.id);
  }

  @Post("invitations")
  invite(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const body = safeObject(input);
    return this.care.invite(user.id, String(body.identifier ?? body.mobile ?? ""));
  }

  @Post("relationships/:id/respond")
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.care.respond(user.id, id, safeObject(input).accepted === true);
  }

  @Post("relationships/:id/permissions")
  savePermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.care.savePermissions(user.id, id, input);
  }

  @Delete("relationships/:id")
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.care.revoke(user.id, id);
  }

  @Get("relationships/:id/health")
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("metric") metric: string,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Req() request: RequestWithContext,
  ) {
    return this.care.preview(user.id, id, metric, from, to, request.requestId);
  }
}
