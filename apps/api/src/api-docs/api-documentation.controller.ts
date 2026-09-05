import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AdminRole } from "@prisma/client";
import { ApiTags } from "@nestjs/swagger";
import { CurrentAdmin } from "../common/request-context";
import { AdminAuditInterceptor } from "../admin/admin-audit.interceptor";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { ApiDocumentationService } from "./api-documentation.service";

@ApiTags("admin-api-documentation")
@Controller("api/saydian-app/admin/v1/api-docs")
@UseGuards(AdminAuthGuard)
@UseInterceptors(AdminAuditInterceptor)
export class ApiDocumentationController {
  constructor(private readonly documentation: ApiDocumentationService) {}

  @Get()
  list() {
    return this.documentation.list();
  }

  @Patch(":routeKey")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.API_DOC_EDITOR)
  update(
    @CurrentAdmin() admin: { id: string },
    @Param("routeKey") routeKey: string,
    @Body() body: unknown,
  ) {
    return this.documentation.update(admin.id, routeKey, body);
  }

  @Get("releases/list")
  releases() {
    return this.documentation.releases();
  }

  @Post("releases")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.API_DOC_EDITOR)
  createRelease(
    @CurrentAdmin() admin: { id: string },
    @Body() body: unknown,
  ) {
    return this.documentation.createRelease(admin.id, body);
  }

  @Post("releases/:id/submit")
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.API_DOC_EDITOR)
  submit(@Param("id") id: string) {
    return this.documentation.submitRelease(id);
  }

  @Post("releases/:id/publish")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  publish(
    @CurrentAdmin() admin: { id: string },
    @Param("id") id: string,
  ) {
    return this.documentation.publishRelease(admin.id, id);
  }

  @Post("releases/:id/rollback")
  @AdminRoles(AdminRole.SUPER_ADMIN)
  rollback(
    @CurrentAdmin() admin: { id: string },
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.documentation.rollback(admin.id, id, body);
  }

  @Get("export/file")
  export(@Query("format") format?: string) {
    return this.documentation.export(format);
  }
}
