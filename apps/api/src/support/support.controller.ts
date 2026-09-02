import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { UserAuthGuard } from "../common/user-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { SupportService } from "./support.service";

@ApiTags("support")
@Controller("api/saydian-app/v2/support")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get("config")
  config() {
    return this.support.supportConfig();
  }

  @Get("app-update")
  appUpdate() {
    return this.support.appUpdateConfig();
  }

  @Post("feedback")
  @UseGuards(UserAuthGuard)
  feedback(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.support.createFeedback(user.id, input);
  }
}

@ApiTags("files")
@Controller("api/saydian-app/v2/files")
export class FilesController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @UseGuards(UserAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Query("purpose") purpose = "feedback",
  ) {
    return this.support.uploadImage(user.id, file, purpose);
  }

  @Post("ecg")
  @UseGuards(UserAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadEcg(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    return this.support.uploadEcgArtifact(
      user.id,
      file,
      String(body.sha256 ?? ""),
    );
  }

  @Get(":id")
  @RawResponse()
  async download(@Param("id") id: string, @Res() response: Response) {
    const file = await this.support.publicFile(id);
    response.setHeader("content-type", file.contentType);
    response.setHeader("content-length", String(file.byteSize));
    response.setHeader("etag", `\"${file.sha256}\"`);
    file.body.pipe(response);
  }
}
