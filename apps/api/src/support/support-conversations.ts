import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, type SupportConversation } from "@prisma/client";
import { businessWritesPaused, cutoverFlag } from "@saydian/app-contracts";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { isUuid, randomToken, safeObject, sha256 } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";
import { memberSyncDiagnostics, parseSyncDiagnostic } from "./sync-diagnostics";
import { SupportAi } from "./support-ai";
import {
  SupportContent,
  supportLocale,
  supportProduct,
} from "./support-content";

export type SupportActor =
  { userId: string } | { guestId: string } | { staffId: string };
type Tx = Prisma.TransactionClient;
const messageFields = {
  id: true,
  seq: true,
  clientMessageId: true,
  sender: true,
  body: true,
  sources: true,
  createdAt: true,
  attachment: { select: { id: true } },
} satisfies Prisma.SupportMessageSelect;
const staffRoles = [
  "SUPER_ADMIN",
  "APP_OPERATIONS",
  "CUSTOMER_SERVICE",
] as const;
const conversationFields = {
  id: true,
  product: true,
  userId: true,
  guestId: true,
  locale: true,
  state: true,
  assignedAdminId: true,
  lastSeq: true,
  lastCustomerSeq: true,
  lastReplySeq: true,
  customerReadSeq: true,
  staffReadSeq: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupportConversationSelect;
type Conversation = Pick<SupportConversation, keyof typeof conversationFields>;
export const supportAttachmentLimit = 5 * 1024 * 1024;
export const staffSupportAccess = (admin: {
  role: string;
  roles: readonly string[];
}) =>
  (admin.roles.length ? admin.roles : [admin.role]).some((role) =>
    (staffRoles as readonly string[]).includes(role),
  );
export const supportGuestPrefix = "srguest.";
const guestTtl = 30 * 86_400_000;
const tooMany = (message: string) =>
  new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);

function ownerWhere(actor: SupportActor): Prisma.SupportConversationWhereInput {
  if ("staffId" in actor) return { product: supportProduct };
  return {
    product: supportProduct,
    ...("userId" in actor
      ? { userId: actor.userId, user: { status: "ACTIVE" } }
      : { guestId: actor.guestId, guest: { expiresAt: { gt: new Date() } } }),
  };
}

function publicConversation(row: Conversation, staff: boolean) {
  return {
    id: row.id,
    state: row.state,
    locale: row.locale,
    lastSeq: row.lastSeq,
    updatedAt: row.updatedAt,
    unread: staff
      ? row.lastCustomerSeq > row.staffReadSeq
      : row.lastReplySeq > row.customerReadSeq,
    ...(staff
      ? { guest: !row.userId, assignedAdminId: row.assignedAdminId }
      : {}),
  };
}

function content(input: unknown) {
  if (
    typeof input !== "string" ||
    input.length > 2000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input)
  )
    throw new BadRequestException("消息需为 1 至 2000 字");
  return input.trim();
}

export async function normalizeSupportImage(
  file: Express.Multer.File | undefined,
): Promise<Buffer> {
  if (!file?.buffer?.length || file.buffer.length > supportAttachmentLimit)
    throw new BadRequestException("请选择不大于 5 MB 的照片");
  try {
    const decoder = sharp(file.buffer, {
      limitInputPixels: 20_000_000,
      failOn: "error",
    });
    const data = await decoder.metadata();
    if (
      !["jpeg", "png", "webp"].includes(data.format ?? "") ||
      (data.pages ?? 1) !== 1
    )
      throw Error();
    // Re-encode after orienting: no original name, metadata, location or active content.
    return await decoder
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new BadRequestException("照片无法读取，请使用 JPG、PNG 或 WebP");
  }
}

@Injectable()
export class SupportConversations implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private aiBusy = false;
  private nextGuestCleanup = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SupportContent,
    private readonly ai: SupportAi,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runAi(), 1_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async enabled() {
    if (!(await this.config.config()).enabled)
      throw new ServiceUnavailableException("在线客服暂未开放");
  }

  async guest(token: string): Promise<{ guestId: string }> {
    if (!/^srguest\.[A-Za-z0-9_-]{32,120}$/.test(token))
      throw new UnauthorizedException("访客会话已失效");
    const row = await this.prisma.supportGuest.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, expiresAt: true },
    });
    if (!row || row.expiresAt <= new Date())
      throw new UnauthorizedException("访客会话已失效");
    return { guestId: row.id };
  }

  async newGuest(locale: unknown) {
    await this.enabled();
    const token = supportGuestPrefix + randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + guestTtl);
    const result = await this.prisma.supportGuest.create({
      data: {
        tokenHash: sha256(token),
        expiresAt,
        conversations: {
          create: {
            product: supportProduct,
            locale: supportLocale(locale),
            state: "ai",
          },
        },
      },
      select: { conversations: { take: 1, select: conversationFields } },
    });
    return {
      token,
      expiresAt,
      conversation: publicConversation(result.conversations[0]!, false),
    };
  }

  private async locked(
    tx: Tx,
    actor: SupportActor,
    id: string,
  ): Promise<Conversation> {
    if (!isUuid(id)) throw new NotFoundException("会话不存在");
    await tx.$queryRaw`SELECT id FROM "SupportConversation" WHERE id = ${id}::uuid AND product = ${supportProduct} FOR UPDATE`;
    const row = await tx.supportConversation.findFirst({
      where: { id, ...ownerWhere(actor) },
      select: conversationFields,
    });
    if (!row) throw new NotFoundException("会话不存在");
    return row;
  }

  async start(actor: SupportActor, language: unknown) {
    await this.enabled();
    if ("staffId" in actor) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      const key = "userId" in actor ? actor.userId : actor.guestId;
      // Serialize repeated opens per participant without requiring a client-provided owner ID.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"say-ring-support:" + key}, 0))`;
      if (
        "guestId" in actor &&
        !(await tx.supportGuest.findFirst({
          where: { id: actor.guestId, expiresAt: { gt: new Date() } },
          select: { id: true },
        }))
      )
        throw new UnauthorizedException("访客会话已失效");
      const where = ownerWhere(actor);
      const existing = await tx.supportConversation.findFirst({
        where: { ...where, state: { not: "closed" } },
        select: conversationFields,
        orderBy: { updatedAt: "desc" },
      });
      const locale = supportLocale(language);
      if (existing)
        return publicConversation(
          existing.locale === locale
            ? existing
            : await tx.supportConversation.update({
                where: { id: existing.id },
                data: { locale },
                select: conversationFields,
              }),
          false,
        );
      const count = await tx.supportConversation.count({
        where: {
          ...where,
          createdAt: { gt: new Date(Date.now() - 86_400_000) },
        },
      });
      if (count >= 10) throw tooMany("今天已打开多次会话，请稍后再试");
      return publicConversation(
        await tx.supportConversation.create({
          data: { product: supportProduct, ...actor, locale },
          select: conversationFields,
        }),
        false,
      );
    });
  }

  async list(actor: SupportActor, filter?: string, before?: string) {
    const staff = "staffId" in actor;
    if (!staff) await this.enabled();
    const take = 30;
    const where: Prisma.SupportConversationWhereInput = {
      ...ownerWhere(actor),
      ...(staff
        ? {
            ...(filter === "mine"
              ? { assignedAdminId: actor.staffId, state: "human" }
              : filter === "closed"
                ? { state: "closed", lastSeq: { gt: 0 } }
                : filter === "ai"
                  ? { state: "ai", lastCustomerSeq: { gt: 0 } }
                  : { state: "waiting" }),
          }
        : { lastSeq: { gt: 0 } }),
    };
    if (before) {
      if (!isUuid(before)) throw new BadRequestException("无效的会话页码");
      const boundary = await this.prisma.supportConversation.findFirst({
        where: { ...where, id: before },
        select: { updatedAt: true },
      });
      if (!boundary) return { items: [], next: null };
      where.OR = [
        { updatedAt: { lt: boundary.updatedAt } },
        { updatedAt: boundary.updatedAt, id: { lt: before } },
      ];
    }
    const list = await this.prisma.supportConversation.findMany({
      where,
      select: conversationFields,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });
    return {
      items: list.slice(0, take).map((row) => publicConversation(row, staff)),
      next: list.length > take ? list[take - 1]!.id : null,
    };
  }

  async snapshot(
    actor: SupportActor,
    id: string,
    cursor: { after?: number | undefined; before?: number | undefined } = {},
    window = 40,
  ) {
    if (!isUuid(id)) throw new NotFoundException("会话不存在");
    // Bound every read to its view of lastSeq. A send racing this query cannot
    // move the cursor past unobserved messages or attach an uncommitted reply.
    const row = await this.prisma.supportConversation.findFirst({
      where: { id, ...ownerWhere(actor) },
      select: conversationFields,
    });
    if (!row) throw new NotFoundException("会话不存在");
    const forward = cursor.after !== undefined;
    const messages =
      forward && cursor.after! >= row.lastSeq
        ? []
        : await this.prisma.supportMessage.findMany({
            where: {
              conversationId: id,
              conversation: ownerWhere(actor),
              seq: {
                lte: row.lastSeq,
                ...(forward
                  ? { gt: cursor.after! }
                  : cursor.before
                    ? { lt: cursor.before }
                    : {}),
              },
            },
            select: messageFields,
            orderBy: { seq: forward ? "asc" : "desc" },
            take: window,
          });
    if (!forward) messages.reverse();
    return {
      conversation: publicConversation(row, "staffId" in actor),
      messages,
      older: (messages[0]?.seq ?? 1) > 1,
    };
  }

  async assertParticipant(actor: SupportActor, id: string) {
    if (
      !isUuid(id) ||
      !(await this.prisma.supportConversation.findFirst({
        where: { id, ...ownerWhere(actor) },
        select: { id: true },
      }))
    )
      throw new NotFoundException("会话不存在");
  }

  async read(actor: SupportActor, id: string, value: unknown) {
    const seq = safeObject(value).seq;
    if (
      typeof seq !== "number" ||
      !Number.isInteger(seq) ||
      seq < 0 ||
      seq > 2_147_483_647
    )
      throw new BadRequestException("无效的已读位置");
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, actor, id);
      const key = "staffId" in actor ? "staffReadSeq" : "customerReadSeq";
      if ("staffId" in actor && row.assignedAdminId !== actor.staffId)
        return { read: false };
      if (seq > row[key])
        await tx.supportConversation.update({
          where: { id },
          data: { [key]: Math.min(seq, row.lastSeq), updatedAt: row.updatedAt },
        });
      return { read: true };
    });
  }

  async claim(actor: { userId: string }, id: string, guestToken: unknown) {
    await this.enabled();
    if (typeof guestToken !== "string")
      throw new UnauthorizedException("访客会话已失效");
    const guest = await this.guest(guestToken);
    return this.prisma.$transaction(async (tx) => {
      await this.locked(tx, guest, id);
      // Transfer a single explicitly selected thread, never all guest history.
      if (
        !(await tx.user.findFirst({
          where: { id: actor.userId, status: "ACTIVE" },
          select: { id: true },
        }))
      )
        throw new UnauthorizedException();
      const result = await tx.supportConversation.update({
        where: { id },
        data: { userId: actor.userId, guestId: null },
        select: conversationFields,
      });
      return publicConversation(result, false);
    });
  }

  async guestDiagnostic(actor: SupportActor, id: string, input: unknown) {
    await this.enabled();
    if (!("guestId" in actor)) throw new ForbiddenException();
    const report = parseSyncDiagnostic(input);
    if (report.schemaVersion !== 2)
      throw new BadRequestException("诊断版本无效");
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, actor, id);
      if (row.state === "closed") throw new ConflictException("会话已结束");
      await tx.supportConversation.update({
        where: { id },
        data: {
          guestDiagnostic: { receivedAt: new Date().toISOString(), report },
          updatedAt: row.updatedAt,
        },
      });
      return { accepted: true };
    });
  }

  async diagnostics(actor: { staffId: string }, id: string, requestId: string) {
    if (!isUuid(id)) throw new NotFoundException("会话不存在");
    const row = await this.prisma.supportConversation.findFirst({
      where: { id, ...ownerWhere(actor) },
      select: { userId: true, guestDiagnostic: true },
    });
    if (!row) throw new NotFoundException("会话不存在");
    await this.prisma.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actor.staffId,
        action: "READ_SUPPORT_DIAGNOSTIC",
        entityType: "SUPPORT_CONVERSATION",
        entityId: id,
        requestId,
      },
    });
    if (row.userId) {
      const result = await memberSyncDiagnostics(this.prisma, row.userId);
      if (!row.guestDiagnostic) return result;
      return {
        ...result,
        reports: [row.guestDiagnostic, ...result.reports].slice(
          0,
          result.maximumReports,
        ),
      };
    }
    return {
      reports: row.guestDiagnostic ? [row.guestDiagnostic] : [],
      maximumReports: 1,
    };
  }

  async send(actor: SupportActor, id: string, input: unknown, file?: Buffer) {
    const staff = "staffId" in actor;
    if (!staff) await this.enabled();
    const body = safeObject(input);
    if (
      typeof body.clientMessageId !== "string" ||
      !isUuid(body.clientMessageId)
    )
      throw new BadRequestException("消息编号无效");
    const clientMessageId = body.clientMessageId;
    const text = content(body.body ?? "");
    if (!text && !file) throw new BadRequestException("请输入消息或选择照片");
    const digest = file ? sha256(file) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, actor, id);
      const sender = staff ? "staff" : "customer";
      const prior = await tx.supportMessage.findUnique({
        where: {
          conversationId_clientMessageId: {
            conversationId: id,
            clientMessageId,
          },
        },
        select: {
          ...messageFields,
          attachment: { select: { id: true, bytes: !!file } },
        },
      });
      if (prior) {
        if (
          prior.sender !== sender ||
          prior.body !== text ||
          !!prior.attachment !== !!file ||
          (prior.attachment &&
            file &&
            sha256(Buffer.from(prior.attachment.bytes)) !== digest)
        )
          throw new ConflictException("此消息编号已使用");
        return {
          ...prior,
          attachment: prior.attachment ? { id: prior.attachment.id } : null,
        };
      }
      if (row.state === "closed") throw new ConflictException("会话已结束");
      if (
        staff &&
        (row.state !== "human" || row.assignedAdminId !== actor.staffId)
      )
        throw new ConflictException("请先接入该会话");
      const since = new Date(Date.now() - 60_000);
      if (
        (await tx.supportMessage.count({
          where: { conversationId: id, sender, createdAt: { gte: since } },
        })) >= 15
      )
        throw tooMany("消息发送较快，请稍后再试");
      // Bounded private DB image storage: images are attached atomically to
      // accepted messages and automatically follow conversation deletion.
      if (
        file &&
        (await tx.supportAttachment.count({
          where: { message: { conversationId: id } },
        })) >= 30
      )
        throw tooMany("此会话的照片已达到上限");
      const askAi =
        !staff &&
        row.state === "ai" &&
        !!text &&
        !file &&
        body.aiAllowed === true;
      const waiting = !staff && row.state === "ai" && !askAi;
      const seq = row.lastSeq + 1;
      const message = await tx.supportMessage.create({
        data: {
          conversationId: id,
          seq,
          clientMessageId,
          sender,
          body: text,
          ...(askAi ? { aiAvailableAt: new Date() } : {}),
          ...(file
            ? { attachment: { create: { bytes: Uint8Array.from(file) } } }
            : {}),
        },
        select: messageFields,
      });
      await tx.supportConversation.update({
        where: { id },
        data: {
          lastSeq: seq,
          ...(staff ? { lastReplySeq: seq } : { lastCustomerSeq: seq }),
          ...(waiting ? { state: "waiting" } : {}),
        },
      });
      if (waiting) await this.stopAi(tx, id);
      if (staff && row.userId) await this.notifyReply(tx, row, message.id);
      return message;
    });
  }

  async image(actor: SupportActor, id: string, attachmentId: string) {
    if (!isUuid(id) || !isUuid(attachmentId))
      throw new NotFoundException("照片不存在");
    const image = await this.prisma.supportAttachment.findFirst({
      where: {
        id: attachmentId,
        message: { conversationId: id, conversation: ownerWhere(actor) },
      },
      select: { bytes: true },
    });
    if (!image) throw new NotFoundException("照片不存在");
    return image.bytes;
  }

  private async stopAi(tx: Tx, id: string) {
    await tx.supportMessage.updateMany({
      where: { conversationId: id, aiAvailableAt: { not: null } },
      data: { aiAvailableAt: null, aiRunId: null },
    });
  }

  async transition(actor: SupportActor, id: string, input: unknown) {
    const staff = "staffId" in actor;
    if (!staff) await this.enabled();
    const command = safeObject(input);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.locked(tx, actor, id);
      let state: string = row.state,
        assignedAdminId = row.assignedAdminId;
      if (!staff && command.action === "handoff") {
        if (state === "ai") state = "waiting";
      } else if (staff && command.action === "accept") {
        if (state === "waiting" || state === "ai") {
          state = "human";
          assignedAdminId = actor.staffId;
        } else if (state !== "human" || assignedAdminId !== actor.staffId)
          throw new ConflictException("会话已由其他人员接待或已结束");
      } else if (
        staff &&
        (command.action === "transfer" || command.action === "close")
      ) {
        if (state !== "human" || assignedAdminId !== actor.staffId)
          throw new ConflictException("仅当前接待人可操作");
        if (command.action === "close") {
          state = "closed";
          assignedAdminId = null;
        } else if (command.assignee === null) {
          state = "waiting";
          assignedAdminId = null;
        } else {
          if (typeof command.assignee !== "string" || !isUuid(command.assignee))
            throw new BadRequestException("请选择可接待的客服");
          const admin = await tx.adminUser.findUnique({
            where: { id: command.assignee },
            select: { active: true, role: true, roles: true },
          });
          if (!admin?.active || !staffSupportAccess(admin))
            throw new BadRequestException("所选人员不可接待");
          assignedAdminId = command.assignee;
        }
      } else throw new BadRequestException("不支持的会话操作");
      if (state === row.state && assignedAdminId === row.assignedAdminId)
        return publicConversation(row, staff);
      if (state !== "ai") await this.stopAi(tx, id);
      const result = await tx.supportConversation.update({
        where: { id },
        data: { state, assignedAdminId },
        select: conversationFields,
      });
      return publicConversation(result, staff);
    });
  }

  async agents() {
    const admins = await this.prisma.adminUser.findMany({
      where: {
        active: true,
        OR: [
          { role: { in: [...staffRoles] } },
          { roles: { hasSome: [...staffRoles] } },
        ],
      },
      select: { id: true, displayName: true, role: true, roles: true },
      orderBy: { displayName: "asc" },
      take: 100,
    });
    return admins
      .filter(staffSupportAccess)
      .map(({ id, displayName }) => ({ id, displayName }));
  }

  private async notifyReply(tx: Tx, row: Conversation, messageId: string) {
    if (!row.userId) return;
    const eventId = `support-reply:${messageId}`;
    const deepLink = `/support/conversations/${row.id}`;
    const english = row.locale === "en";
    const notification = await tx.notification.create({
      data: {
        userId: row.userId,
        eventId,
        type: "SYSTEM",
        title: english ? "New support reply" : "客服有新回复",
        body: english
          ? "Open the conversation to view your reply."
          : "打开会话查看回复。",
        deepLink,
      },
    });
    await tx.outboxEvent.create({
      data: {
        eventId,
        eventType: "system",
        aggregateType: "support_conversation",
        aggregateId: row.id,
        payload: {
          userId: row.userId,
          notificationId: notification.id,
          deepLink,
        },
      },
    });
  }

  async runAi() {
    if (
      this.aiBusy ||
      businessWritesPaused(process.env) ||
      cutoverFlag(process.env.WORKER_PAUSED)
    )
      return;
    this.aiBusy = true;
    let work:
      | {
          id: string;
          conversationId: string;
          body: string;
          locale: string;
          run: string;
        }
      | undefined;
    try {
      const now = new Date();
      if (now.getTime() >= this.nextGuestCleanup) {
        this.nextGuestCleanup = now.getTime() + 3_600_000;
        const expired = await this.prisma.supportGuest.findMany({
          where: { expiresAt: { lte: now } },
          select: { id: true },
          take: 50,
        });
        if (expired.length)
          await this.prisma.supportGuest.deleteMany({
            where: {
              id: { in: expired.map((g) => g.id) },
              expiresAt: { lte: now },
            },
          });
        // Claimed threads no longer reference the guest and are retained.
      }
      if (!(await this.config.config()).enabled) return;
      const candidate = await this.prisma.supportMessage.findFirst({
        where: {
          aiAvailableAt: { lte: now },
          conversation: {
            product: supportProduct,
            state: "ai",
            OR: [
              { user: { status: "ACTIVE" } },
              { guest: { expiresAt: { gt: now } } },
            ],
          },
        },
        select: {
          id: true,
          conversationId: true,
          body: true,
          conversation: { select: { locale: true } },
        },
        orderBy: { aiAvailableAt: "asc" },
      });
      if (!candidate) return;
      const run = randomUUID();
      const claimed = await this.prisma.supportMessage.updateMany({
        where: { id: candidate.id, aiAvailableAt: { lte: now } },
        data: { aiRunId: run, aiAvailableAt: new Date(now.getTime() + 60_000) },
      });
      if (!claimed.count) return;
      work = { ...candidate, locale: candidate.conversation.locale, run };
      const reply = await this.ai.answer(work.locale, work.body);
      await this.finishAi(work, reply);
    } catch {
      // A process/network failure leaves the leased job available for retry.
      // No arbitrary provider error, user text or identity reaches logs.
    } finally {
      this.aiBusy = false;
    }
  }

  async finishAi(
    work: { id: string; conversationId: string; run: string },
    reply: { body: string; sources: { id: string; title: string }[] },
  ) {
    if (
      businessWritesPaused(process.env) ||
      cutoverFlag(process.env.WORKER_PAUSED) ||
      !(await this.config.config()).enabled
    )
      return;
    return this.prisma.$transaction(async (tx) => {
      // Take the same lock as handoff before checking state or inserting the
      // response. AI completion can never overwrite an accepted human handoff.
      const actor = { staffId: "support-ai" };
      const row = await this.locked(tx, actor, work.conversationId);
      if (row.state !== "ai") return;
      if (
        !(await tx.supportConversation.findFirst({
          where: {
            id: row.id,
            OR: [
              { user: { status: "ACTIVE" } },
              { guest: { expiresAt: { gt: new Date() } } },
            ],
          },
          select: { id: true },
        }))
      )
        return;
      const job = await tx.supportMessage.updateMany({
        where: {
          id: work.id,
          conversationId: row.id,
          aiRunId: work.run,
          aiAvailableAt: { not: null },
        },
        data: { aiRunId: null, aiAvailableAt: null },
      });
      if (job.count !== 1) return;
      const seq = row.lastSeq + 1;
      const message = await tx.supportMessage.create({
        data: {
          conversationId: row.id,
          seq,
          sender: "ai",
          body: reply.body,
          sources: reply.sources,
        },
        select: { id: true },
      });
      await tx.supportConversation.update({
        where: { id: row.id },
        data: { lastSeq: seq, lastReplySeq: seq },
      });
      if (row.userId) await this.notifyReply(tx, row, message.id);
    });
  }
}
