import { BadRequestException, Body, ConflictException, Controller, Get, Put, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminRole, Prisma } from "@prisma/client";
import { jstRenewalKey, jstRenewalPlan, type JstRenewal } from "@saydian/app-contracts";
import { AdminAuthGuard, AdminRoles } from "./admin-auth";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { safeObject, sha256 } from "../common/crypto";

@ApiTags("admin")
@Controller("api/saydian-app/admin/v1/commerce-jobs/token-renewal")
@UseGuards(AdminAuthGuard)
@UseInterceptors(AdminAuditInterceptor)
export class JushuitanRenewalController {
  constructor(private readonly prisma: PrismaService, private readonly secrets: IntegrationSecretsService) {}
  @Get()
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.INTEGRATION_ADMIN, AdminRole.COMMERCE_OPERATIONS, AdminRole.READ_ONLY)
  async status() {
    return (await this.prisma.appSetting.findUnique({ where: { key: jstRenewalKey } }))?.value ?? { enabled: false, status: "UNCONFIGURED", message: "请填写有效的访问令牌、刷新令牌和有效期以启用自动续期" };
  }
  @Put()
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.INTEGRATION_ADMIN)
  async configure(@Body() input: unknown) {
    const body = safeObject(input);
    if (Object.keys(body).some(k => !["enabled", "issuedAt", "expiresAt", "accessToken", "refreshToken"].includes(k)) || typeof body.enabled !== "boolean") throw new BadRequestException("续期参数不正确");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM "IntegrationConfig" WHERE key = 'jushuitan' FOR UPDATE`;
      const integration = await tx.integrationConfig.findUnique({ where: { key: "jushuitan" } });
      if (!integration) throw new BadRequestException("请先在集成中心配置聚水潭");
      await tx.$queryRaw`SELECT key FROM "AppSetting" WHERE key = ${jstRenewalKey} FOR UPDATE`;
      const old = (await tx.appSetting.findUnique({ where: { key: jstRenewalKey } }))?.value as unknown as JstRenewal | undefined;
      if (old?.status === "RUNNING" && Date.now() - Date.parse(old.attemptedAt || "") < 120_000) throw new ConflictException("正在续期，请稍后再修改");
      let value: JstRenewal;
      if (!body.enabled) value = { ...(old ?? { issuedAt: "", expiresAt: "", nextAttemptAt: "" }), enabled: false, status: old && !["READY", "DISABLED"].includes(old.status) ? old.status : "DISABLED", message: "自动续期已关闭" };
      else {
        if (integration.state !== "CONFIGURED") throw new BadRequestException("聚水潭集成尚未启用");
        if (!body.accessToken && !body.refreshToken) {
          if (!old || !["READY", "DISABLED"].includes(old.status) || !Number.isFinite(Date.parse(old.expiresAt)) || Date.parse(old.expiresAt) <= Date.now()) throw new BadRequestException("请填写同次授权返回的两种有效令牌及准确有效期");
          value = { ...old, enabled: true, status: "READY", message: "等待自动续期检查" };
        } else {
          if (typeof body.accessToken !== "string" || typeof body.refreshToken !== "string" || !body.accessToken.trim() || !body.refreshToken.trim() || body.accessToken.length > 4096 || body.refreshToken.length > 4096) throw new BadRequestException("请填写同次授权返回的访问令牌和刷新令牌");
          if (typeof body.issuedAt !== "string" || typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.issuedAt)) || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.issuedAt) > Date.now() || Date.parse(body.expiresAt) <= Date.now()) throw new BadRequestException("请填写实际获取时间及未来的到期时间");
          let nextAttemptAt: string;
          try { nextAttemptAt = jstRenewalPlan(body.issuedAt, body.expiresAt); } catch { throw new BadRequestException("有效期需超过16天，已过期令牌须重新授权"); }
          const stored = await this.secrets.read("jushuitan");
          const encrypted = this.secrets.prepare("jushuitan", { ...stored, accessToken: body.accessToken.trim(), refreshToken: body.refreshToken.trim() });
          await tx.integrationSecret.upsert({ where: { integrationKey: "jushuitan" }, create: { integrationKey: "jushuitan", ...encrypted }, update: encrypted });
          value = { enabled: true, issuedAt: new Date(body.issuedAt).toISOString(), expiresAt: new Date(body.expiresAt).toISOString(), nextAttemptAt, status: "READY", message: "等待自动续期检查", secretVersion: sha256(encrypted.ciphertext) };
        }
      }
      await tx.appSetting.upsert({ where: { key: jstRenewalKey }, create: { key: jstRenewalKey, public: false, value: value as unknown as Prisma.InputJsonValue }, update: { public: false, value: value as unknown as Prisma.InputJsonValue } });
      return value;
    });
  }
}
