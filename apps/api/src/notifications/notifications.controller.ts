import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@Controller("api/saydian-app/v2/notifications")
@UseGuards(UserAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("product") product?: string,
  ) {
    return this.notifications.list(user.id, Number(page ?? 1), Number(pageSize ?? 30), product);
  }

  @Get("unread-count")
  unread(@CurrentUser() user: AuthenticatedUser, @Query("product") product?: string) {
    return this.notifications.unreadCount(user.id, product);
  }

  @Get("preferences")
  preferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.preferences(user.id);
  }

  @Patch("preferences")
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return this.notifications.updatePreferences(user.id, input);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Query("product") product?: string) {
    return this.notifications.detail(user.id, id, product);
  }

  @Post(":id/read")
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() input?: { product?: string }) {
    return this.notifications.markRead(user.id, id, input?.product);
  }

  @Post("push-installations")
  register(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.notifications.registerInstallation(user.id, input);
  }

  @Delete("push-installations/:installationId")
  unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Param("installationId") installationId: string,
  ) {
    return this.notifications.unregisterInstallation(user.id, installationId);
  }
}
