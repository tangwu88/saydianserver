import {
  Body,
  Controller,
  Get,
  Header,
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

  @Get("app-display")
  @Header("Cache-Control", "no-store")
  appDisplay(@Query("product") product?: string) {
    return this.support.appDisplayConfig(product);
  }

  @Get("app-update")
  appUpdate(@Query("product") product?: string) {
    return this.support.appUpdateConfig(product);
  }

  @Get("sport-map-config")
  sportMapConfig() {
    return this.support.sportMapConfig();
  }

  @Post("sport-route-map")
  @UseGuards(UserAuthGuard)
  @RawResponse()
  async sportRouteMap(@Body() input: unknown, @Res() response: Response) {
    const image = await this.support.sportRouteMap(input);
    response.setHeader("content-type", image.contentType);
    response.setHeader("content-length", String(image.body.length));
    response.setHeader("cache-control", "private, no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.end(image.body);
  }

  @Get("app-package/:fileName")
  @RawResponse()
  async appPackage(
    @Param("fileName") fileName: string,
    @Res() response: Response,
  ) {
    const file = await this.support.publicAppPackage(fileName);
    response.setHeader("content-type", file.contentType);
    response.setHeader("content-length", String(file.byteSize));
    response.setHeader(
      "content-disposition",
      `attachment; filename="${fileName}"`,
    );
    response.setHeader("etag", `"${file.sha256}"`);
    response.setHeader("x-content-type-options", "nosniff");
    file.body.pipe(response);
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
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Query("purpose") purpose = "feedback",
  ) {
    return this.support.uploadImage(user.id, file, purpose);
  }

  @Post("ecg")
  @UseGuards(UserAuthGuard)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
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
