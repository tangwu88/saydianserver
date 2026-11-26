import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CareStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";
import { careMetricMap } from "../care/care.service";
import {
  calendarDate, careAudio, careMessageKinds, cleanText, currentCareWeek, digest,
  inviteCode, newInviteCode, reactionKinds, ringAvailability, ringEnabled, ringSnapshot, ringUuid, shareToken,
} from "./ring-contract";
import { shareProjectNames } from "./ring-share-presentation";

type Tx = Prisma.TransactionClient;
const dayMs = 86_400_000;
const publicName = (name: string | null | undefined) =>
  name?.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 40) || null;

const messageFields = {
  id: true, authorId: true, kind: true, keepQuiet: true, attachment: true, createdAt: true,
} as const;
const shareFields = { id: true, snapshot: true, createdAt: true, expiresAt: true } as const;
const reactionFields = { kind: true, name: true, createdAt: true } as const;

@Injectable()
export class RingExperienceService {
  constructor(private readonly db: PrismaService) {}

  async createShare(ownerId: string, input: unknown) {
    ringEnabled("sharing");
    const body = safeObject(input);
    if (body.confirmed !== true) throw new BadRequestException("请先确认分享内容");
    const snapshot = ringSnapshot(body.snapshot);
    const key = digest(shareToken(body.token));
    const expiresAt = new Date(Date.now() + 7 * dayMs);
    const row = await this.db.ringShare.upsert({
      where: { digest: key }, update: {},
      create: { ownerId, digest: key, snapshot, expiresAt },
      select: { id: true, expiresAt: true, ownerId: true },
    });
    if (row.ownerId !== ownerId || +row.expiresAt <= Date.now()) {
      throw new ConflictException("请重新生成分享链接");
    }
    return { id: row.id, expiresAt: row.expiresAt };
  }

  async shares(ownerId: string, history = false, before?: string) {
    // Owners can review and revoke existing links while public access is paused.
    if (!history) ringEnabled("sharing");
    const now = new Date();
    const cursor = before && await this.db.ringShare.findFirst({
      where: { id: ringUuid(before), ownerId }, select: { id: true },
    });
    if (before && !cursor) throw new NotFoundException("请刷新分享列表");
    const limit = history ? 30 : 60;
    const entries = await this.db.ringShare.findMany({
      where: { ownerId, ...(!history ? { expiresAt: { gt: now } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
      select: { ...shareFields,
        reactions: {
          orderBy: [{ createdAt: "desc" }, { visitor: "desc" }], take: 15,
          select: reactionFields,
        }, _count: { select: { reactions: true } },
      },
    });
    const more = entries.length > limit;
    if (more) entries.pop();
    return { entries, nextBefore: more ? entries.at(-1)?.id : null };
  }

  async shareReplies(ownerId: string, id: string, before?: string) {
    const shareId = ringUuid(id);
    if (before !== undefined && !/^[a-f0-9]{64}$/.test(before)) {
      throw new BadRequestException("回应页码无效");
    }
    const limit = 30;
    const row = await this.db.ringShare.findFirst({
      where: { id: shareId, ownerId },
      select: {
        ...shareFields,
        _count: { select: { reactions: true } },
        reactions: {
          orderBy: [{ createdAt: "desc" }, { visitor: "desc" }],
          take: limit + 1,
          ...(before ? { cursor: { shareId_visitor: { shareId, visitor: before } }, skip: 1 } : {}),
          select: { ...reactionFields, visitor: true },
        },
      },
    });
    if (!row) throw new NotFoundException("这条分享暂不可查看");
    const { reactions, ...share } = row;
    const page = reactions.slice(0, limit);
    return {
      share,
      reactions: page.map(({ kind, name, createdAt }) => ({ kind, name, createdAt })),
      nextBefore: reactions.length > limit ? page.at(-1)?.visitor ?? null : null,
    };
  }

  async revokeShare(ownerId: string, id: string) {
    // Revocation remains available while creation and public access are paused.
    await this.db.ringShare.deleteMany({ where: { id: ringUuid(id), ownerId } });
    return { ok: true };
  }

  async openShare(input: unknown) {
    ringEnabled("sharing");
    const titleRef = digest(shareToken(safeObject(input).token));
    const row = await this.activeShare(titleRef);
    if (!row) throw new NotFoundException("链接已失效");
    return {
      snapshot: row.snapshot,
      expiresAt: row.expiresAt,
      sharerName: publicName(row.owner.nickname),
      projectNames: shareProjectNames(row.snapshot),
      titleRef,
    };
  }

  async shareTitle(reference: unknown, acceptLanguage: string | undefined) {
    if (typeof reference !== "string" || !/^[0-9a-f]{64}$/.test(reference) ||
        !ringAvailability().sharing) return null;
    const row = await this.activeShare(reference);
    if (!row) return null;
    const language = (acceptLanguage ?? "zh-Hans").split(/[;,]/, 1)[0]!.trim().toLowerCase();
    const chinese = /^zh(?:-|$)/.test(language) && !/(?:^|-)(hant|tw|hk|mo)(?:-|$)/.test(language);
    const project = shareProjectNames(row.snapshot)[chinese ? 0 : 1];
    const note = safeObject(row.snapshot).note;
    return [publicName(row.owner.nickname), project, typeof note === "string" ? note.trim() : null, "Say Ring"]
      .filter(Boolean).join(" · ");
  }

  private activeShare(key: string) {
    return this.db.ringShare.findFirst({
      where: { digest: key, expiresAt: { gt: new Date() }, owner: { status: "ACTIVE" } },
      select: { snapshot: true, expiresAt: true, owner: { select: { nickname: true } } },
    });
  }

  async react(input: unknown, actorId?: string) {
    ringEnabled("sharing");
    const body = safeObject(input);
    const token = shareToken(body.token);
    const kind = body.kind;
    if (typeof kind !== "string" || !(reactionKinds as readonly string[]).includes(kind)) {
      throw new BadRequestException("回应无效");
    }
    return this.db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "RingShare" WHERE "digest" = ${digest(token)}
          AND "expiresAt" > NOW() FOR UPDATE
      `;
      if (!locked) throw new NotFoundException("链接已失效");
      const share = await tx.ringShare.findFirst({
        where: { id: locked.id, owner: { status: "ACTIVE" } },
        select: { id: true, ownerId: true },
      });
      if (!share) throw new NotFoundException("链接已失效");
      let name: string | null = null;
      if (actorId && actorId === share.ownerId) throw new BadRequestException("请将链接分享给好友");
      if (actorId && body.named === true) {
        const pair = await tx.careRelationship.findFirst({
          where: {
            status: "ACTIVE", revokedAt: null,
            OR: [{ inviterId: actorId, recipientId: share.ownerId },
              { inviterId: share.ownerId, recipientId: actorId }],
            ringSettings: { none: { blocked: true } },
          },
          select: { id: true },
        });
        if (!pair) throw new ForbiddenException("请选择匿名回应");
        name = publicName((await tx.user.findUnique({
          where: { id: actorId }, select: { nickname: true },
        }))?.nickname);
      }
      const visitorIdentity = actorId ? "member:" + actorId : "guest:" + ringUuid(body.visitor);
      const visitor = digest(share.id + ":" + visitorIdentity);
      const count = await tx.ringShareReaction.createMany({
        data: [{ shareId: share.id, visitor, memberId: actorId ?? null, name, kind }],
        skipDuplicates: true,
      });
      if (count.count === 1) {
        await this.notify(tx, "ring-share:" + randomUUID(), share.ownerId, share.id, "share", true);
      }
      return { ok: true };
    });
  }

  async createInvite(inviterId: string) {
    ringEnabled("care");
    const code = newInviteCode();
    const expiresAt = new Date(Date.now() + 2 * dayMs);
    const row = await this.db.ringCareInvite.create({ data: {
      inviterId, digest: digest(code), expiresAt,
    }, select: { id: true, expiresAt: true } });
    return { ...row, code };
  }

  async invites(inviterId: string) {
    ringEnabled("care");
    const entries = await this.db.ringCareInvite.findMany({
      where: { inviterId, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, expiresAt: true, createdAt: true },
    });
    return { entries };
  }

  async revokeInvite(inviterId: string, id: string) {
    await this.db.ringCareInvite.updateMany({
      where: { id: ringUuid(id), inviterId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async previewInvite(input: unknown) {
    ringEnabled("care");
    const code = inviteCode(safeObject(input).code);
    const invite = await this.db.ringCareInvite.findFirst({
      where: { digest: digest(code), expiresAt: { gt: new Date() }, revokedAt: null,
        acceptedAt: null, inviter: { status: "ACTIVE" } },
      select: { inviter: { select: { nickname: true } }, expiresAt: true },
    });
    if (!invite) throw new NotFoundException("邀请已失效");
    return { inviterName: publicName(invite.inviter.nickname), expiresAt: invite.expiresAt };
  }

  async acceptInvite(userId: string, input: unknown) {
    ringEnabled("care");
    const body = safeObject(input);
    const code = inviteCode(body.code);
    if (body.confirmed !== true || !Array.isArray(body.metrics) || body.metrics.length > 14) {
      throw new BadRequestException("请确认邀请和共享选项");
    }
    const metrics = [...new Set<unknown>(body.metrics)].map((item) => {
      if (typeof item !== "string" || !Object.hasOwn(careMetricMap, item)) {
        throw new BadRequestException("共享选项无效");
      }
      return careMetricMap[item as keyof typeof careMetricMap];
    });
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "RingCareInvite" WHERE "digest" = ${digest(code)} FOR UPDATE
      `;
      const invite = locked && await tx.ringCareInvite.findFirst({
        where: { id: locked.id, expiresAt: { gt: now }, revokedAt: null,
          inviter: { status: "ACTIVE" } },
        select: { id: true, inviterId: true, acceptedAt: true, acceptedBy: true },
      });
      if (!invite || (invite.acceptedAt && invite.acceptedBy !== userId)) {
        throw new NotFoundException("邀请已失效");
      }
      if (invite.inviterId === userId) throw new BadRequestException("不能接受自己发出的邀请");
      const members = [invite.inviterId, userId].sort();
      await this.lock(tx, "pair:" + members.join(":"));
      const where = { inviterId_recipientId: { inviterId: invite.inviterId, recipientId: userId } };
      const blocked = await tx.ringCareSetting.findFirst({
        where: { blocked: true, relationship: {
          OR: [{ inviterId: invite.inviterId, recipientId: userId },
            { inviterId: userId, recipientId: invite.inviterId }],
        } }, select: { userId: true },
      });
      if (blocked) throw new NotFoundException("邀请已失效");
      if (invite.acceptedAt) {
        const prior = await tx.careRelationship.findUnique({ where, select: { id: true, status: true } });
        if (prior?.status !== CareStatus.ACTIVE) throw new NotFoundException("邀请已失效");
        return { relationshipId: prior.id };
      }

      // createMany tolerates a concurrent invitation arriving through the existing contact API.
      const created = await tx.careRelationship.createMany({
        data: { inviterId: invite.inviterId, recipientId: userId,
          invitationId: "ring-link-" + invite.id, status: "ACTIVE", respondedAt: now },
        skipDuplicates: true,
      });
      const relation = await tx.careRelationship.findUniqueOrThrow({ where });
      const activated = await tx.careRelationship.updateMany({
        where: { id: relation.id, status: { not: "ACTIVE" } },
        data: { status: "ACTIVE", respondedAt: now, revokedAt: null, expiresAt: null,
          invitationId: "ring-link-" + invite.id },
      });
      if (created.count || activated.count) {
        await tx.carePermission.deleteMany({ where: { relationshipId: relation.id } });
        if (metrics.length) await tx.carePermission.createMany({
          data: metrics.map((metric) => ({ relationshipId: relation.id, metric })),
        });
      }
      await tx.ringCareInvite.update({
        where: { id: invite.id }, data: { acceptedBy: userId, acceptedAt: now },
      });
      if (created.count || activated.count) {
        await this.notify(tx, "ring-joined:" + invite.id, invite.inviterId, relation.id, "care", true);
      }
      return { relationshipId: relation.id };
    });
  }

  private async relation(tx: Tx, rawId: string, userId: string, allowBlocked = false) {
    const id = ringUuid(rawId);
    const row = await tx.careRelationship.findFirst({
      where: { id, status: "ACTIVE", revokedAt: null,
        OR: [{ inviterId: userId }, { recipientId: userId }],
        inviter: { status: "ACTIVE" }, recipient: { status: "ACTIVE" },
      },
      select: { id: true, inviterId: true, recipientId: true, ringSettings: true },
    });
    if (!row || (!allowBlocked && row.ringSettings.some((setting) => setting.blocked))) {
      throw new NotFoundException("这段关爱关系暂不可用");
    }
    return { ...row, other: row.inviterId === userId ? row.recipientId : row.inviterId };
  }

  private async lock(tx: Tx, identity: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;
  }

  async thread(userId: string, id: string, before?: string) {
    ringEnabled("care");
    const relation = await this.relation(this.db, id, userId, true);
    const mine = relation.ringSettings.find((s) => s.userId === userId);
    const blocked = relation.ringSettings.some((s) => s.blocked);
    if (blocked && !mine?.blocked) throw new NotFoundException("这段关爱关系暂不可用");
    const cursor = before && await this.db.ringCareMessage.findFirst({
      where: { id: ringUuid(before), relationshipId: relation.id }, select: { id: true },
    });
    if (before && !cursor) throw new NotFoundException("消息不存在");
    const messages = blocked ? [] : await this.db.ringCareMessage.findMany({
      where: { relationshipId: relation.id, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 40,
      ...(cursor ? { cursor, skip: 1 } : {}),
      select: messageFields,
    });
    return { messages: messages.map((row) => this.message(userId, row)),
      muted: mine?.muted ?? false, blocked, canUnblock: mine?.blocked === true };
  }

  async send(userId: string, id: string, input: unknown) {
    ringEnabled("care");
    const body = safeObject(input);
    const messageId = ringUuid(body.messageId);
    const kind = body.kind;
    if (typeof kind !== "string" || !(careMessageKinds as readonly string[]).includes(kind)) {
      throw new BadRequestException("问候类型无效");
    }
    const audio = kind === "voice" ? careAudio(body.audio) : undefined;
    const attachment = body.attachment == null ? undefined : ringSnapshot(body.attachment);
    if (attachment && (attachment.kind !== "workout" || kind !== "walked")) {
      throw new BadRequestException("请选择这次散步记录");
    }
    return this.db.$transaction(async (tx) => {
      const relation = await this.relation(tx, id, userId);
      await this.lock(tx, "pair:" + [userId, relation.other].sort().join(":"));
      const current = await this.relation(tx, id, userId);
      const inserted = await tx.ringCareMessage.createMany({ skipDuplicates: true, data: [{
        id: messageId, relationshipId: current.id, authorId: userId, kind,
        keepQuiet: body.keepQuiet === true, audio: audio ? Uint8Array.from(audio) : null,
        ...(attachment ? { attachment } : {}),
      }] });
      const row = await tx.ringCareMessage.findFirst({
        where: { id: messageId, relationshipId: current.id, authorId: userId, deletedAt: null },
        select: messageFields,
      });
      if (!row || row.kind !== kind) throw new ConflictException("请重新发送");
      if (inserted.count) {
        const muted = current.ringSettings.some((s) => s.userId === current.other && s.muted);
        await this.notify(tx, "ring-care:" + row.id, current.other, current.id, "care", !muted);
      }
      return this.message(userId, row);
    });
  }

  private message(userId: string, row: Prisma.RingCareMessageGetPayload<{ select: typeof messageFields }>) {
    return {
      id: row.id, kind: row.kind, mine: row.authorId === userId,
      keepQuiet: row.keepQuiet, attachment: row.attachment, createdAt: row.createdAt,
    };
  }

  async liveGreetings(userId: string, after: string | undefined) {
    ringEnabled("care");
    const now = new Date();
    const since = after ? new Date(after) : now;
    if (!Number.isFinite(+since) || +since > +now + 10_000) throw new BadRequestException();
    const start = new Date(Math.max(+since, +now - 20_000));
    const rows = await this.db.ringCareMessage.findMany({
      where: { kind: "thinking", authorId: { not: userId }, deletedAt: null,
        createdAt: { gt: start, lte: now },
        relationship: { status: "ACTIVE", revokedAt: null,
          OR: [{ inviterId: userId }, { recipientId: userId }],
          inviter: { status: "ACTIVE" }, recipient: { status: "ACTIVE" },
          ringSettings: { none: { OR: [{ blocked: true }, { userId, muted: true }] } },
        },
      },
      orderBy: { createdAt: "asc" }, take: 20,
      select: { id: true, createdAt: true },
    });
    return { cursor: now.toISOString(), entries: rows };
  }

  async setting(userId: string, id: string, input: unknown) {
    const body = safeObject(input);
    if (typeof body.muted !== "boolean" && typeof body.blocked !== "boolean") throw new BadRequestException();
    if (body.blocked !== true) ringEnabled("care");
    return this.db.$transaction(async (tx) => {
      const row = await this.relation(tx, id, userId, true);
      await this.lock(tx, "pair:" + [userId, row.other].sort().join(":"));
      const current = await this.relation(tx, id, userId, true);
      const data = {
        ...(typeof body.muted === "boolean" ? { muted: body.muted } : {}),
        ...(typeof body.blocked === "boolean" ? { blocked: body.blocked } : {}),
      };
      const result = await tx.ringCareSetting.upsert({
        where: { relationshipId_userId: { relationshipId: current.id, userId } },
        create: { relationshipId: current.id, userId, ...data }, update: data,
        select: { muted: true, blocked: true },
      });
      if (body.blocked === true) {
        // Stop the other participant's current health access through older clients as well.
        if (current.recipientId === userId) {
          await tx.carePermission.deleteMany({ where: { relationshipId: current.id } });
        }
      }
      return result;
    });
  }

  async voice(userId: string, id: string, messageId: string) {
    ringEnabled("care");
    const relation = await this.relation(this.db, id, userId);
    const row = await this.db.ringCareMessage.findFirst({
      where: { id: ringUuid(messageId), relationshipId: relation.id, kind: "voice", deletedAt: null },
      select: { audio: true },
    });
    if (!row?.audio) throw new NotFoundException("语音已删除");
    return row.audio;
  }

  async deleteMessage(userId: string, id: string, messageId: string) {
    const relation = await this.relation(this.db, id, userId, true);
    await this.db.ringCareMessage.updateMany({
      where: { id: ringUuid(messageId), relationshipId: relation.id, authorId: userId, deletedAt: null },
      data: { deletedAt: new Date(), audio: null, attachment: Prisma.DbNull },
    });
    return { ok: true };
  }

  async report(userId: string, id: string, messageId: string) {
    const relation = await this.relation(this.db, id, userId, true);
    await this.db.ringCareMessage.updateMany({
      where: { id: ringUuid(messageId), relationshipId: relation.id,
        authorId: relation.other, reportedAt: null },
      data: { reportedAt: new Date() },
    });
    return { ok: true };
  }

  async goals(userId: string, id: string) {
    ringEnabled("care");
    const relation = await this.relation(this.db, id, userId);
    const { week, today } = currentCareWeek();
    const [list, activityAvailable] = await Promise.all([
      this.db.ringCareGoal.findMany({
        where: { relationshipId: relation.id, week },
        select: { userId: true, target: true, days: true, paused: true },
      }),
      this.hasRecordedActivity(this.db, userId, today),
    ]);
    return { week, today, activityAvailable,
      members: list.map((row) => ({
        mine: row.userId === userId,
        target: row.target,
        completed: Array.isArray(row.days) ? row.days.length : 0,
        checkedToday: row.userId === userId && Array.isArray(row.days) &&
          row.days.some((entry) => safeObject(entry).day === today),
        paused: row.paused,
      })),
    };
  }

  private async hasRecordedActivity(tx: Tx, userId: string, today: string) {
    const start = new Date(today + "T00:00:00+08:00");
    const until = new Date(Math.min(+start + dayMs, Date.now()));
    const row = await tx.healthRecord.findFirst({
      where: {
        userId, metric: "STEPS", quality: "VALID",
        sourceMeasurementSource: "wearable",
        observedAt: { gte: start, lte: until },
        AND: [
          { OR: [{ aggregationKind: null }, { aggregationActive: true }] },
          {
            OR: ["value", "steps"].map((key) => ({
              AND: [
                { values: { path: [key], gt: 0 } },
                { values: { path: [key], lte: 500_000 } },
              ],
            })),
          },
        ],
      },
      select: { id: true },
    });
    return row !== null;
  }

  async saveGoal(userId: string, id: string, input: unknown) {
    ringEnabled("care");
    const body = safeObject(input);
    await this.db.$transaction(async (tx) => {
      const relation = await this.relation(tx, id, userId);
      await this.lock(tx, "pair:" + [userId, relation.other].sort().join(":"));
      await this.relation(tx, id, userId);
      const { week, today } = currentCareWeek();
      if (body.week !== week) throw new ConflictException("新的一周，请刷新");
      const key = { relationshipId: relation.id, userId, week };
      const where = { relationshipId_userId_week: key };
      if (typeof body.target === "number" && Number.isInteger(body.target) &&
          body.target >= 1 && body.target <= 7) {
        await tx.ringCareGoal.upsert({
          where, update: { target: body.target, paused: false },
          create: { ...key, target: body.target },
        });
      } else if (typeof body.paused === "boolean") {
        await tx.ringCareGoal.updateMany({ where: key, data: { paused: body.paused } });
      } else {
        const source = body.source;
        if (calendarDate(body.day) !== today || (source !== "manual" && source !== "workout")) {
          throw new BadRequestException("请选择今天的散步");
        }
        const row = await tx.ringCareGoal.findUnique({ where });
        if (!row || row.paused) throw new ConflictException("请先开始本周约定");
        const days = Array.isArray(row.days) ? row.days.map(safeObject) : [];
        if (!days.some((entry) => entry.day === today)) {
          if (source === "workout" && !await this.hasRecordedActivity(tx, userId, today)) {
            throw new ConflictException("当天暂无已同步的活动记录");
          }
          const retained = days.flatMap((entry) => typeof entry.day === "string" &&
            (entry.source === "manual" || entry.source === "workout")
            ? [{ day: entry.day, source: entry.source }] : []);
          await tx.ringCareGoal.update({ where, data: { days: [...retained, { day: today, source }] } });
        }
      }
    });
    return this.goals(userId, id);
  }

  async operationsSummary() {
    // Aggregate only the outcomes required for the internal launch.
    const [usage] = await this.db.$queryRaw<{
      shares: number; reacted: number; accepted: number; observed: number; replied: number;
    }[]>`
      WITH completed_windows AS (
        SELECT "inviterId", "acceptedBy", "acceptedAt" FROM "RingCareInvite"
        WHERE "acceptedAt" > NOW() - INTERVAL '30 days'
          AND "acceptedAt" <= NOW() - INTERVAL '7 days'
      )
      SELECT
        (SELECT count(*)::int FROM "RingShare" WHERE "expiresAt" > NOW()) AS shares,
        (SELECT count(*)::int FROM "RingShare" s WHERE s."expiresAt" > NOW()
          AND EXISTS (SELECT 1 FROM "RingShareReaction" rr WHERE rr."shareId" = s.id)) AS reacted,
        (SELECT count(*)::int FROM "RingCareInvite" i WHERE i."acceptedAt" > NOW() - INTERVAL '30 days') AS accepted,
        (SELECT count(*)::int FROM completed_windows) AS observed,
        (SELECT count(*)::int FROM completed_windows i
          JOIN "CareRelationship" c ON c."inviterId" = i."inviterId" AND c."recipientId" = i."acceptedBy"
          WHERE EXISTS (
            SELECT 1 FROM "RingCareMessage" greeting
            JOIN "RingCareMessage" reply
              ON reply."relationshipId" = c.id AND reply."authorId" <> greeting."authorId"
              AND reply."createdAt" > greeting."createdAt" AND reply.kind = 'thinkingBack'
              AND reply."deletedAt" IS NULL
            WHERE greeting."relationshipId" = c.id AND greeting.kind = 'thinking'
              AND greeting."deletedAt" IS NULL
              AND greeting."createdAt" >= i."acceptedAt"
              AND reply."createdAt" < i."acceptedAt" + INTERVAL '7 days'
          )
        ) AS replied
    `;
    const reports = await this.db.ringCareMessage.findMany({
      where: { reportedAt: { not: null }, deletedAt: null },
      select: { id: true, kind: true, reportedAt: true },
      orderBy: { reportedAt: "desc" }, take: 50,
    });
    return { usage, reports };
  }

  async removeReported(id: string) {
    await this.db.ringCareMessage.updateMany({
      where: { id: ringUuid(id), reportedAt: { not: null }, deletedAt: null },
      data: { deletedAt: new Date(), audio: null, attachment: Prisma.DbNull },
    });
    return { ok: true };
  }

  private async notify(tx: Tx, eventId: string, userId: string, entity: string,
    kind: "care" | "share", push: boolean) {
    const deepLink = (kind === "care" ? "/care/interactions/" : "/ring/shares/") + entity;
    const notification = await tx.notification.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: {
        eventId, userId, type: "SYSTEM", deepLink,
        title: kind === "share" ? "有人回应了你的分享" : "远程爱有新消息",
        body: kind === "share" ? "点击查看好友回应。" : "打开 Say Ring 查看。",
      },
      update: { readAt: null, createdAt: new Date() },
      select: { id: true },
    });
    if (push) {
      await tx.outboxEvent.createMany({ skipDuplicates: true, data: [{
        eventId, eventType: "system", aggregateType: kind === "share" ? "ring_share" : "ring_care", aggregateId: entity,
        payload: { userId, notificationId: notification.id, deepLink },
      }] });
    }
  }
}
