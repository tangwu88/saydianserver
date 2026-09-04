import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { RawResponse } from "./common/raw-response.decorator";
import { PrismaService } from "./common/prisma.service";

@Controller("health")
@RawResponse()
export class StatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("live")
  live() {
    return { status: "ok", service: "saydianapp-server", revision: process.env.APP_REVISION || "unversioned" };
  }

  @Get("ready")
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ready", database: "ok", revision: process.env.APP_REVISION || "unversioned" };
    } catch {
      throw new ServiceUnavailableException("服务尚未准备完成");
    }
  }
}
