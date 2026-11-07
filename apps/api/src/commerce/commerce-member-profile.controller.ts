import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { isUuid, safeObject } from "../common/crypto";
import { env } from "../common/environment";
import { PrismaService } from "../common/prisma.service";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { UserAuthGuard } from "../common/user-auth.guard";
import { MembersService } from "../members/members.service";
import { SupportService } from "../support/support.service";
import { validateEvidenceImage } from "./commerce-evidence";

@ApiTags("commerce-member-profile")
@Controller("api/saidian-mall/v1/storefront/member-profile")
@UseGuards(UserAuthGuard)
@RawResponse()
export class CommerceMemberProfileController {
  constructor(
    private readonly members: MembersService,
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.members.profile(user.id);
  }

  @Put()
  @Header("Cache-Control", "private, no-store")
  async save(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const body = safeObject(input),
      data: Record<string, unknown> = {};
    for (const key of [
      "nickname",
      "gender",
      "birthday",
      "heightCm",
      "weightKg",
    ])
      if (body[key] !== undefined) data[key] = body[key];
    if (body.avatarFileId !== undefined) {
      if (body.avatarFileId === null) data.avatarUrl = "";
      else {
        if (!isUuid(String(body.avatarFileId)))
          throw new BadRequestException("请重新上传头像");
        const file = await this.prisma.fileObject.findFirst({
          where: {
            id: String(body.avatarFileId),
            ownerUserId: user.id,
            purpose: "avatar",
            status: "ACTIVE",
            contentType: { in: ["image/jpeg", "image/png", "image/webp"] },
          },
          select: { id: true },
        });
        if (!file) throw new BadRequestException("请使用本人上传的头像");
        data.avatarUrl = `${env("PUBLIC_BASE_URL", "http://localhost:8080").replace(/\/$/, "")}/api/saydian-app/v2/files/${file.id}`;
      }
    }
    return this.members.saveProfile(user.id, data);
  }

  @Post("avatar")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  avatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    validateEvidenceImage(file);
    return this.support.uploadSayRingAvatar(user.id, file);
  }
}
