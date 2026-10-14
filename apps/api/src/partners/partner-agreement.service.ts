import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { isUuid, safeObject, sha256 } from "../common/crypto";

@Injectable()
export class PartnerAgreementService {
  constructor(private readonly prisma: PrismaService) {}
  async list() {
    return {
      items: await this.prisma.partnerAgreement.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    };
  }
  async draft(actorId: string, input: unknown, requestId: string) {
    const body = safeObject(input),
      id = body.id ? String(body.id) : null;
    const title = String(body.title ?? "").trim(),
      version = String(body.version ?? "").trim(),
      content = String(body.content ?? "").trim();
    if (
      !title ||
      title.length > 100 ||
      !/^[A-Za-z0-9_.-]{1,60}$/.test(version) ||
      !content ||
      content.length > 50000 ||
      (id && !isUuid(id))
    )
      throw new BadRequestException("请填写有效的标题、版本和协议正文");
    return this.prisma.$transaction(async (tx) => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM "PartnerAgreement" WHERE id = ${id}::uuid FOR UPDATE`;
        const existing = await tx.partnerAgreement.findUnique({
          where: { id },
        });
        if (!existing) throw new NotFoundException("协议不存在");
        if (existing.status !== "DRAFT")
          throw new ConflictException("已发布协议不能修改，请新建版本");
        if (String(body.updatedAt ?? "") !== existing.updatedAt.toISOString())
          throw new ConflictException("草稿已变化，请刷新后修改");
      }
      const duplicate = await tx.partnerAgreement.findUnique({
        where: { version },
      });
      if (duplicate && duplicate.id !== id)
        throw new ConflictException("协议版本已存在");
      const values = {
        title,
        version,
        content,
        contentSha256: sha256(content),
      };
      const result = id
        ? await tx.partnerAgreement.update({ where: { id }, data: values })
        : await tx.partnerAgreement.create({
            data: { ...values, createdById: actorId },
          });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId,
          action: "PARTNER_AGREEMENT_DRAFT_SAVED",
          entityType: "PARTNER_AGREEMENT",
          entityId: result.id,
          afterJson: { version, contentSha256: result.contentSha256 },
          requestId,
        },
      });
      return result;
    });
  }
  async publish(
    actorId: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    if (!isUuid(id)) throw new NotFoundException("协议不存在");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('partner-agreement-publication'))`;
      await tx.$queryRaw`SELECT id FROM "PartnerAgreement" WHERE id = ${id}::uuid FOR UPDATE`;
      const agreement = await tx.partnerAgreement.findUnique({ where: { id } });
      if (!agreement) throw new NotFoundException("协议不存在");
      if (agreement.active && agreement.status === "PUBLISHED")
        return agreement;
      if (
        agreement.status !== "DRAFT" ||
        safeObject(input).contentSha256 !== agreement.contentSha256
      )
        throw new ConflictException("协议内容已变化，请重新查看后发布");
      await tx.partnerAgreement.updateMany({
        where: { active: true },
        data: { active: false },
      });
      const result = await tx.partnerAgreement.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          active: true,
          publishedAt: new Date(),
          publishedById: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId,
          action: "PARTNER_AGREEMENT_PUBLISHED",
          entityType: "PARTNER_AGREEMENT",
          entityId: id,
          afterJson: {
            version: result.version,
            contentSha256: result.contentSha256,
          },
          requestId,
        },
      });
      return result;
    });
  }
  async current(
    partnerId: string,
    sessionId: string,
    clientIp?: string,
    userAgent?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('partner-agreement-publication'))`;
      const agreement = await tx.partnerAgreement.findFirst({
        where: { active: true, status: "PUBLISHED" },
      });
      if (!agreement) return { agreement: null, accepted: true };
      const receipt = await tx.partnerAgreementAcceptance.upsert({
        where: {
          partnerId_agreementId: { partnerId, agreementId: agreement.id },
        },
        create: {
          partnerId,
          agreementId: agreement.id,
          sessionId,
          clientIp: clientIp?.slice(0, 100) ?? null,
          userAgent: userAgent?.slice(0, 500) ?? null,
        },
        update: {},
      });
      return {
        agreement: {
          id: agreement.id,
          title: agreement.title,
          version: agreement.version,
          content: agreement.content,
          contentSha256: agreement.contentSha256,
          publishedAt: agreement.publishedAt,
        },
        accepted: !!receipt.acceptedAt,
        viewedAt: receipt.viewedAt,
        acceptedAt: receipt.acceptedAt,
      };
    });
  }
  async accept(
    partnerId: string,
    sessionId: string,
    input: unknown,
    requestId: string,
    clientIp?: string,
    userAgent?: string,
  ) {
    const body = safeObject(input);
    if (body.agreed !== true)
      throw new BadRequestException("请阅读并勾选同意合作协议");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('partner-agreement-publication'))`;
      const agreement = await tx.partnerAgreement.findFirst({
        where: { active: true, status: "PUBLISHED" },
      });
      if (
        !agreement ||
        agreement.id !== body.agreementId ||
        agreement.contentSha256 !== body.contentSha256
      )
        throw new ConflictException("合作协议已更新，请重新阅读");
      const receipt = await tx.partnerAgreementAcceptance.findUnique({
        where: {
          partnerId_agreementId: { partnerId, agreementId: agreement.id },
        },
      });
      if (!receipt) throw new ForbiddenException("请先打开并阅读合作协议");
      if (receipt.acceptedAt)
        return { accepted: true, acceptedAt: receipt.acceptedAt };
      const result = await tx.partnerAgreementAcceptance.update({
        where: { id: receipt.id },
        data: {
          acceptedAt: new Date(),
          sessionId,
          clientIp: clientIp?.slice(0, 100) ?? null,
          userAgent: userAgent?.slice(0, 500) ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "PARTNER",
          actorId: partnerId,
          action: "PARTNER_AGREEMENT_ACCEPTED",
          entityType: "PARTNER_AGREEMENT",
          entityId: agreement.id,
          afterJson: {
            version: agreement.version,
            contentSha256: agreement.contentSha256,
            sessionId,
            clientIp: result.clientIp,
            userAgent: result.userAgent,
            acceptedAt: result.acceptedAt!.toISOString(),
          },
          requestId,
        },
      });
      return { accepted: true, acceptedAt: result.acceptedAt };
    });
  }
  async acceptances(id: string) {
    if (!isUuid(id)) throw new NotFoundException("协议不存在");
    return {
      items: await this.prisma.partnerAgreementAcceptance.findMany({
        where: { agreementId: id },
        include: { partner: { select: { name: true, username: true } } },
        orderBy: { viewedAt: "desc" },
        take: 1000,
      }),
    };
  }
}
