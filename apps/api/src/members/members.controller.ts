import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { MembersService } from "./members.service";

@ApiTags("members")
@Controller("api/saydian-app/v2/members/me")
@UseGuards(UserAuthGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.members.profile(user.id);
  }

  @Put()
  saveProfile(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.members.saveProfile(user.id, input);
  }

  @Get("goals")
  goals(@CurrentUser() user: AuthenticatedUser) {
    return this.members.goals(user.id);
  }

  @Put("goals")
  saveGoals(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.members.saveGoals(user.id, input);
  }
}
