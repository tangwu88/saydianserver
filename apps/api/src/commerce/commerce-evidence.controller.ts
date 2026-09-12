import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { AdminAuthGuard } from "../admin/admin-auth";
import {
  CurrentAdmin,
  CurrentUser,
  type AuthenticatedUser,
  type RequestWithContext,
} from "../common/request-context";
import { RawResponse } from "../common/raw-response.decorator";
import { UserAuthGuard } from "../common/user-auth.guard";
import { SupportService } from "../support/support.service";
import { evidenceLimits } from "./commerce-evidence";

function stream(
  file: { body: NodeJS.ReadableStream; contentType: string; byteSize: number },
  response: Response,
) {
  response.setHeader("content-type", file.contentType);
  response.setHeader("content-length", String(file.byteSize));
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; sandbox");
  file.body.on("error", () => response.destroy());
  file.body.pipe(response);
}

@ApiTags("commerce-evidence")
@Controller("api/saidian-mall/v1/storefront/after-sale-images")
@UseGuards(UserAuthGuard)
@RawResponse()
export class CommerceEvidenceController {
  constructor(private readonly support: SupportService) {}

  @Get("capabilities")
  capabilities() {
    return this.support.commerceEvidenceCapability();
  }

  @Post()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: evidenceLimits.maxBytes, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.support.uploadCommerceEvidence(user.id, file);
  }

  @Get(":id")
  async image(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    stream(await this.support.commerceEvidence(user.id, id), response);
  }
}

/**
 * Native international App surface. It deliberately mirrors the reviewed H5
 * evidence semantics under the isolated App V2 route family, so the Flutter
 * client never has to call a compatibility or domestic storefront endpoint.
 */
@ApiTags("commerce-evidence")
@Controller("api/saydian-app/v2/commerce/after-sale-images")
@UseGuards(UserAuthGuard)
export class AppCommerceEvidenceController {
  constructor(private readonly support: SupportService) {}

  @Get("capabilities")
  capabilities() {
    return this.support.commerceEvidenceCapability();
  }

  @Post()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: evidenceLimits.maxBytes, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.support.uploadCommerceEvidence(user.id, file);
  }

  @Get(":id")
  @RawResponse()
  async image(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    stream(await this.support.commerceEvidence(user.id, id), response);
  }
}

@ApiTags("admin-commerce-evidence")
@Controller("api/saydian-app/admin/v1/commerce-after-sales")
@UseGuards(AdminAuthGuard)
export class AdminCommerceEvidenceController {
  constructor(private readonly support: SupportService) {}

  @Get(":saleId/evidence/:fileId")
  @RawResponse()
  async image(
    @CurrentAdmin() admin: { id: string; role: string; roles?: string[] },
    @Param("saleId") saleId: string,
    @Param("fileId") fileId: string,
    @Req() request: RequestWithContext,
    @Res() response: Response,
  ) {
    stream(
      await this.support.adminCommerceEvidence(
        admin,
        saleId,
        fileId,
        request.requestId,
      ),
      response,
    );
  }
}
