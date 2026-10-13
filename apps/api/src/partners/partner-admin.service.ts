import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { safeObject, isUuid } from "../common/crypto";
import {
  partnerPage,
  partnerRequestKey,
  partnerNumber,
} from "./partner-commerce.service";
import { PartnerService } from "./partner.service";
import { postPartnerLedger, PARTNER_MAX_CENTS } from "./partner-ledger";

const partnerSelect = {
  id: true,
  partnerNo: true,
  username: true,
  name: true,
  mobile: true,
  active: true,
  promotionCode: true,
  levelId: true,
  level: true,
  wallet: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true, orders: true } },
} satisfies Prisma.BrandPartnerSelect;
function text(input: unknown, label: string, max = 80) {
  const value = String(input ?? "").trim();
  if (!value || value.length > max)
    throw new BadRequestException(`${label}格式不正确`);
  return value;
}
function password(input: unknown) {
  const value = String(input ?? "");
  if (value.length < 10 || value.length > 128)
    throw new BadRequestException("密码须为10至128个字符");
  return value;
}
function expectedTime(input: unknown) {
  const value = new Date(String(input ?? ""));
  if (!Number.isFinite(value.getTime()))
    throw new BadRequestException("请刷新后再修改");
  return value;
}

@Injectable()
export class PartnerAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnerService,
  ) {}

  private audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    id: string,
    afterJson: Prisma.InputJsonValue,
    requestId: string,
  ) {
    return tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId,
        action,
        entityType: "BRAND_PARTNER",
        entityId: id,
        afterJson,
        requestId,
      },
    });
  }

  async list(search: string, pageInput: unknown) {
    const { page, pageSize, skip } = partnerPage(pageInput);
    const where: Prisma.BrandPartnerWhereInput = search
      ? {
          OR: [
            { name: { contains: search.trim(), mode: "insensitive" } },
            { username: { contains: search.trim(), mode: "insensitive" } },
            { partnerNo: { contains: search.trim(), mode: "insensitive" } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.brandPartner.findMany({
        where,
        select: partnerSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.brandPartner.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async create(actorId: string, input: unknown, requestId: string) {
    const body = safeObject(input),
      username = text(body.username, "登录账号");
    if (
      !/^[A-Za-z0-9_.-]{3,80}$/.test(username) ||
      !isUuid(String(body.levelId ?? ""))
    )
      throw new BadRequestException("登录账号或分销等级不正确");
    const name = text(body.name, "伙伴名称"),
      mobile = String(body.mobile ?? "").trim();
    if (mobile.length > 30) throw new BadRequestException("联系方式过长");
    const passwordHash = await hash(password(body.password), 12);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const level = await tx.partnerLevel.findFirst({
          where: { id: body.levelId as string, active: true },
        });
        if (!level) throw new BadRequestException("请选择有效的分销等级");
        const partner = await tx.brandPartner.create({
          data: {
            partnerNo: partnerNumber("VIP"),
            username,
            passwordHash,
            name,
            mobile: mobile || null,
            levelId: level.id,
            promotionCode: randomBytes(12).toString("hex"),
            wallet: { create: {} },
          },
          select: partnerSelect,
        });
        await this.audit(
          tx,
          actorId,
          "PARTNER_CREATED",
          partner.id,
          { username, name, levelId: level.id },
          requestId,
        );
        return partner;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("登录账号已存在");
      throw error;
    }
  }

  async update(actorId: string, id: string, input: unknown, requestId: string) {
    if (!isUuid(id)) throw new NotFoundException("品牌伙伴不存在");
    const body = safeObject(input),
      updatedAt = expectedTime(body.updatedAt);
    const data: Prisma.BrandPartnerUncheckedUpdateManyInput = {};
    if (body.name !== undefined) data.name = text(body.name, "伙伴名称");
    if (body.mobile !== undefined) {
      const mobile = String(body.mobile ?? "").trim();
      if (mobile.length > 30) throw new BadRequestException("联系方式过长");
      data.mobile = mobile || null;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean")
        throw new BadRequestException("账户状态不正确");
      data.active = body.active;
    }
    if (body.levelId !== undefined) {
      if (!isUuid(String(body.levelId)))
        throw new BadRequestException("分销等级不正确");
      data.levelId = String(body.levelId);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${id}::uuid FOR UPDATE`;
      if (
        data.levelId &&
        !(await tx.partnerLevel.findFirst({
          where: { id: String(data.levelId), active: true },
        }))
      )
        throw new BadRequestException("分销等级不可用");
      const changed = await tx.brandPartner.updateMany({
        where: { id, updatedAt },
        data,
      });
      if (!changed.count) throw new ConflictException("伙伴资料已变化，请刷新");
      if (body.active === false)
        await tx.partnerSession.updateMany({
          where: { partnerId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await this.audit(
        tx,
        actorId,
        "PARTNER_UPDATED",
        id,
        {
          name: body.name ?? null,
          active: body.active ?? null,
          levelId: body.levelId ?? null,
        } as Prisma.InputJsonValue,
        requestId,
      );
      return tx.brandPartner.findUniqueOrThrow({
        where: { id },
        select: partnerSelect,
      });
    });
  }

  async resetPassword(
    actorId: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    if (!isUuid(id)) throw new NotFoundException("品牌伙伴不存在");
    const passwordHash = await hash(password(safeObject(input).password), 12);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${id}::uuid FOR UPDATE`;
      if (!(await tx.brandPartner.findUnique({ where: { id } })))
        throw new NotFoundException("品牌伙伴不存在");
      await tx.brandPartner.update({ where: { id }, data: { passwordHash } });
      await tx.partnerSession.updateMany({
        where: { partnerId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(
        tx,
        actorId,
        "PARTNER_PASSWORD_RESET",
        id,
        { sessionsRevoked: true },
        requestId,
      );
    });
    return { changed: true };
  }

  levels() {
    return this.prisma.partnerLevel.findMany({
      orderBy: [{ sort: "asc" }, { id: "asc" }],
    });
  }

  async saveLevel(
    actorId: string,
    id: string | null,
    input: unknown,
    requestId: string,
  ) {
    const body = safeObject(input),
      name = text(body.name, "等级名称", 40),
      sort = Number(body.sort ?? 0),
      active = body.active ?? true;
    if (
      !Number.isInteger(sort) ||
      sort < 0 ||
      sort > 10000 ||
      typeof active !== "boolean" ||
      (id && !isUuid(id))
    )
      throw new BadRequestException("等级信息不正确");
    return this.prisma.$transaction(async (tx) => {
      let level;
      if (id) {
        const changed = await tx.partnerLevel.updateMany({
          where: { id, updatedAt: expectedTime(body.updatedAt) },
          data: { name, sort, active },
        });
        if (!changed.count)
          throw new ConflictException("等级信息已变化，请刷新");
        level = await tx.partnerLevel.findUniqueOrThrow({ where: { id } });
      } else
        level = await tx.partnerLevel.create({
          data: {
            code: `distribution-${randomBytes(6).toString("hex")}`,
            name,
            sort,
            active,
          },
        });
      await this.audit(
        tx,
        actorId,
        "PARTNER_LEVEL_SAVED",
        level.id,
        { name, sort, active },
        requestId,
      );
      return level;
    });
  }

  async prices(levelId: string, search: string, pageInput: unknown) {
    if (!isUuid(levelId)) throw new BadRequestException("请选择分销等级");
    const { page, pageSize, skip } = partnerPage(pageInput);
    const where: Prisma.CommerceSkuWhereInput = {
      product: {
        localArchived: false,
        ...(search
          ? { name: { contains: search.trim(), mode: "insensitive" } }
          : {}),
      },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.commerceSku.findMany({
        where,
        select: {
          id: true,
          specification: true,
          enabled: true,
          salePriceCents: true,
          product: { select: { id: true, name: true, status: true } },
          partnerPrices: { where: { levelId } },
        },
        orderBy: { id: "asc" },
        skip,
        take: pageSize,
      }),
      this.prisma.commerceSku.count({ where }),
    ]);
    return {
      items: rows.map(({ partnerPrices, ...row }) => ({
        ...row,
        price: partnerPrices[0] ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async savePrice(
    actorId: string,
    levelId: string,
    skuId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = safeObject(input),
      priceCents = Number(body.priceCents),
      enabled = body.enabled ?? true;
    if (
      !isUuid(levelId) ||
      !isUuid(skuId) ||
      !Number.isSafeInteger(priceCents) ||
      priceCents <= 0 ||
      priceCents > PARTNER_MAX_CENTS ||
      typeof enabled !== "boolean"
    )
      throw new BadRequestException("分销价信息不正确");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-price:${levelId}:${skuId}`}))`;
      if (
        !(await tx.partnerLevel.findUnique({ where: { id: levelId } })) ||
        !(await tx.commerceSku.findUnique({ where: { id: skuId } }))
      )
        throw new NotFoundException("等级或商品规格不存在");
      const existing = await tx.partnerSkuPrice.findUnique({
        where: { levelId_skuId: { levelId, skuId } },
      });
      if (
        existing
          ? existing.updatedAt.getTime() !==
            expectedTime(body.updatedAt).getTime()
          : body.updatedAt != null
      )
        throw new ConflictException("分销价已变化，请刷新");
      const price = await tx.partnerSkuPrice.upsert({
        where: { levelId_skuId: { levelId, skuId } },
        create: { levelId, skuId, priceCents, enabled },
        update: { priceCents, enabled },
      });
      await this.audit(
        tx,
        actorId,
        "PARTNER_PRICE_SAVED",
        skuId,
        { levelId, priceCents, enabled },
        requestId,
      );
      return price;
    });
  }

  async assignMember(
    actorId: string,
    userId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = safeObject(input),
      partnerId = body.partnerId === null ? null : String(body.partnerId ?? ""),
      reason = text(body.reason, "归属调整原因", 300);
    const expectedPartnerId =
      body.expectedPartnerId === null
        ? null
        : String(body.expectedPartnerId ?? "");
    if (
      !isUuid(userId) ||
      (partnerId && !isUuid(partnerId)) ||
      (expectedPartnerId && !isUuid(expectedPartnerId)) ||
      body.partnerId === undefined ||
      body.expectedPartnerId === undefined
    )
      throw new BadRequestException("会员或伙伴归属不正确");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { partnerId: true },
      });
      if (!user) throw new NotFoundException("会员不存在");
      if (user.partnerId !== expectedPartnerId)
        throw new ConflictException("会员归属已变化，请刷新");
      if (
        partnerId &&
        !(await tx.brandPartner.findFirst({
          where: { id: partnerId, active: true },
        }))
      )
        throw new BadRequestException("目标品牌伙伴不可用");
      await tx.user.update({ where: { id: userId }, data: { partnerId } });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId,
          action: "PARTNER_MEMBER_ASSIGNED",
          entityType: "USER",
          entityId: userId,
          beforeJson: { partnerId: user.partnerId },
          afterJson: { partnerId, reason },
          requestId,
        },
      });
      return { userId, partnerId };
    });
  }

  async deposit(
    actorId: string,
    partnerId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = safeObject(input),
      deltaCents = Number(body.deltaCents),
      type = String(body.type ?? ""),
      reason = text(body.reason, "登记原因", 300);
    if (
      !isUuid(partnerId) ||
      !Number.isSafeInteger(deltaCents) ||
      !deltaCents ||
      Math.abs(deltaCents) > PARTNER_MAX_CENTS ||
      !["DEPOSIT_RECEIPT", "DEPOSIT_RETURN", "DEPOSIT_CORRECTION"].includes(
        type,
      ) ||
      (type === "DEPOSIT_RECEIPT" && deltaCents < 0) ||
      (type === "DEPOSIT_RETURN" && deltaCents > 0)
    )
      throw new BadRequestException("保证金登记信息不正确");
    const idempotencyKey = `partner-deposit:${partnerId}:${partnerRequestKey(body.idempotencyKey)}`;
    return this.recordFunds(
      actorId,
      partnerId,
      "DEPOSIT",
      type,
      deltaCents,
      idempotencyKey,
      reason,
      body.referenceNo,
      requestId,
    );
  }

  async rechargeBalance(
    actorId: string,
    partnerId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = safeObject(input),
      amountCents = Number(body.amountCents),
      reason = text(body.reason, "充值原因", 300);
    if (
      !isUuid(partnerId) ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > PARTNER_MAX_CENTS
    )
      throw new BadRequestException("充值金额须为有效的正数");
    const key = `partner-manual-recharge:${partnerId}:${partnerRequestKey(body.idempotencyKey)}`;
    return this.recordFunds(
      actorId,
      partnerId,
      "BALANCE",
      "MANUAL_RECHARGE",
      amountCents,
      key,
      reason,
      body.referenceNo,
      requestId,
    );
  }

  private recordFunds(
    actorId: string,
    partnerId: string,
    account: "BALANCE" | "DEPOSIT",
    type: string,
    deltaCents: number,
    idempotencyKey: string,
    reason: string,
    referenceInput: unknown,
    requestId: string,
  ) {
    const referenceNo = String(referenceInput ?? "").trim();
    if (referenceNo.length > 120)
      throw new BadRequestException("收款凭证编号不能超过120个字符");
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.brandPartner.findUnique({
          where: { id: partnerId },
          select: { id: true },
        }))
      )
        throw new NotFoundException("品牌伙伴不存在");
      await tx.$queryRaw`SELECT "partnerId" FROM "PartnerWallet" WHERE "partnerId" = ${partnerId}::uuid FOR UPDATE`;
      const existing = await tx.partnerLedger.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        if (
          existing.partnerId !== partnerId ||
          existing.account !== account ||
          existing.type !== type ||
          existing.deltaCents !== deltaCents ||
          existing.reason !== reason ||
          existing.actorId !== actorId ||
          existing.referenceId !== (referenceNo || null)
        )
          throw new ConflictException(
            "该登记已提交，不能使用同一请求修改金额或说明",
          );
        return existing;
      }
      const actor = await tx.adminUser.findUnique({
        where: { id: actorId },
        select: { username: true, displayName: true },
      });
      const ledger = await postPartnerLedger(tx, {
        partnerId,
        account,
        type,
        deltaCents,
        idempotencyKey,
        reason,
        actorId,
        ...(referenceNo ? { referenceId: referenceNo } : {}),
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId,
          action:
            account === "BALANCE"
              ? "PARTNER_BALANCE_RECHARGED"
              : "PARTNER_DEPOSIT_RECORDED",
          entityType: "PARTNER_LEDGER",
          entityId: ledger.id,
          requestId,
          beforeJson: {
            partnerId,
            account,
            balanceCents: ledger.balanceAfterCents - deltaCents,
          },
          afterJson: {
            partnerId,
            ledgerId: ledger.id,
            account,
            type,
            deltaCents,
            balanceAfterCents: ledger.balanceAfterCents,
            reason,
            referenceNo,
            operatorUsername: actor?.username ?? actorId,
            operatorName: actor?.displayName ?? actorId,
          },
        },
      });
      return ledger;
    });
  }

  promotion(id: string) {
    return this.partners.promotion(id);
  }
  wallet(id: string) {
    return this.partners.wallet(id);
  }
  async ledger(id: string, account: string, page: unknown) {
    const result = await this.partners.ledger(id, account, page);
    const audits = await this.prisma.auditLog.findMany({
      where: {
        entityType: "PARTNER_LEDGER",
        entityId: { in: result.items.map((item) => item.id) },
      },
      select: {
        id: true,
        entityId: true,
        actorId: true,
        afterJson: true,
        requestId: true,
      },
    });
    return {
      ...result,
      items: result.items.map((item) => {
        const audit = audits.find((row) => row.entityId === item.id),
          snapshot = safeObject(audit?.afterJson);
        return {
          ...item,
          balanceBeforeCents: item.balanceAfterCents - item.deltaCents,
          operatorName: snapshot.operatorName ?? null,
          operatorUsername: snapshot.operatorUsername ?? null,
          actorId: audit?.actorId ?? null,
          referenceNo: snapshot.referenceNo ?? null,
          auditId: audit?.id ?? null,
          requestId: audit?.requestId ?? null,
        };
      }),
    };
  }
  recharges(id: string, page: unknown) {
    return this.partners.recharges(id, page);
  }
}
