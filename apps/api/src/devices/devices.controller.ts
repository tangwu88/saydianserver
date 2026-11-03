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
import { DevicesService } from "./devices.service";

@ApiTags("devices")
@Controller("api/saydian-app/v2/devices")
@UseGuards(UserAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get("binding-history-status")
  bindingHistoryStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query("product") product: string,
    @Query("deviceId") deviceId: string,
  ) {
    return this.devices.bindingHistoryStatus(user.id, product, deviceId);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.devices.list(user.id);
  }

  @Get("binding-initialization-status")
  bindingInitializationStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query("product") product: string,
    @Query("deviceId") deviceId: string,
    @Query("operationId") operationId: string,
  ) {
    return this.devices.bindingInitializationStatus(user.id, product, deviceId, operationId);
  }

  @Post("first-binding-decision")
  firstBindingDecision(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    // 专用路由确保旧服务端拒绝新协议，而不是忽略操作号后消耗一次性授权。
    return this.devices.firstBindingDecision(user.id, input);
  }

  @Post()
  bind(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.devices.bind(user.id, input);
  }

  @Patch(":id/capabilities")
  updateCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.devices.updateCapabilities(user.id, id, input);
  }

  @Delete(":id")
  unbind(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.devices.unbind(user.id, id);
  }
}
