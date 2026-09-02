import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { RawResponse } from "../common/raw-response.decorator";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { SupportService } from "../support/support.service";
import { legacySuccess } from "./legacy-response";

@Controller("api/v1/file")
@RawResponse()
@UseGuards(UserAuthGuard)
export class LegacyFilesController {
  constructor(private readonly support: SupportService) {}

  @Post("images")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.support.uploadImage(user.id, file, "avatar");
    return legacySuccess({ ...result, path: result.url }, "上传成功");
  }
}
