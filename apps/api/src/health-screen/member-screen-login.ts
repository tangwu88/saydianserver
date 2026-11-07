import {
  CanActivate,
  ExecutionContext,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Prisma } from "@prisma/client";
import { screenEnabled } from "@saydian/health-domain";
import { PrismaService } from "../common/prisma.service";
import type {
  AuthenticatedUser,
  RequestWithContext,
} from "../common/request-context";
import { isH5PhoneTestSession } from "../auth/global-wechat-policy";

const key = () => randomBytes(32).toString("hex");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function checked(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new GoneException("登录请求已失效，请刷新二维码");
  return hash(value);
}
const pairingCode = (digest: string) =>
  String(parseInt(digest.slice(0, 8), 16) % 10000).padStart(4, "0");
const unavailable = () => new NotFoundException("健康大屏尚未开放");
export function chinaScreenSite() {
  return (process.env.DEPLOYMENT_SITE || "cn") === "cn";
}
@Injectable()
export class MemberScreenLogin {
  constructor(private readonly db: PrismaService) {}
  async enabled() {
    return chinaScreenSite() && (await screenEnabled(this.db));
  }
  private async requireOpen() {
    if (!(await this.enabled())) throw unavailable();
  }
  private async parent(db: Prisma.TransactionClient, id: string, uid?: string) {
    const session = await db.userSession.findFirst({
      where: {
        id,
        ...(uid ? { userId: uid } : {}),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: "ACTIVE" },
      },
      select: { id: true, userId: true, accessJti: true, expiresAt: true },
    });
    if (!session || isH5PhoneTestSession(session.accessJti))
      throw new UnauthorizedException("会员登录已失效");
    return session;
  }
  private expiry(until: Date) {
    return new Date(Math.min(+until, Date.now() + 8 * 3600000));
  }
  private async clean() {
    await this.db.healthScreenLogin.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }
  async exchange(user: AuthenticatedUser) {
    await this.requireOpen();
    await this.clean();
    const s = await this.parent(this.db, user.sessionId, user.id),
      token = key(),
      expiresAt = this.expiry(s.expiresAt),
      now = new Date();
    await this.db.healthScreenLogin.create({
      data: {
        scanHash: hash(key()),
        pollHash: hash(key()),
        viewHash: hash(token),
        sessionId: s.id,
        approvedAt: now,
        consumedAt: now,
        expiresAt,
      },
    });
    return { token, expiresAt };
  }
  async createQr() {
    await this.requireOpen();
    await this.clean();
    const scan = key(),
      poll = key(),
      scanHash = hash(scan),
      expiresAt = new Date(Date.now() + 3 * 60000);
    const site = new URL(
      process.env.COMMERCE_STOREFRONT_URL ||
        process.env.PUBLIC_BASE_URL ||
        "https://app.saydian.cn",
    );
    if (
      process.env.NODE_ENV === "production" &&
      site.origin !== "https://app.saydian.cn"
    )
      throw unavailable();
    const link = new URL("/global/saidian-mall/", site.origin);
    link.hash = "/pages/health-screen-authorize/index?scan=" + scan;
    const qr = await QRCode.toDataURL(link.href, { width: 224, margin: 3 });
    await this.db.healthScreenLogin.create({
      data: { scanHash, pollHash: hash(poll), expiresAt },
    });
    return {
      poll,
      qr,
      scanUrl: link.href,
      expiresAt,
      match: pairingCode(scanHash),
    };
  }
  async inspect(scan: unknown) {
    await this.requireOpen();
    const scanHash = checked(scan),
      found = await this.db.healthScreenLogin.findFirst({
        where: {
          scanHash,
          approvedAt: null,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { expiresAt: true },
      });
    if (!found) throw new GoneException("二维码已使用或过期，请刷新大屏二维码");
    return { match: pairingCode(scanHash), expiresAt: found.expiresAt };
  }
  async approve(scan: unknown, user: AuthenticatedUser) {
    await this.requireOpen();
    const scanHash = checked(scan);
    await this.parent(this.db, user.sessionId, user.id);
    const res = await this.db.healthScreenLogin.updateMany({
      where: {
        scanHash,
        approvedAt: null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { sessionId: user.sessionId, approvedAt: new Date() },
    });
    if (res.count !== 1) throw new GoneException("二维码已使用或过期");
    return { approved: true };
  }
  async poll(value: unknown) {
    await this.requireOpen();
    const pollHash = checked(value);
    return this.db.$transaction(async (tx) => {
      const row = await tx.healthScreenLogin.findFirst({
        where: { pollHash, consumedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!row) throw new GoneException("二维码已使用或过期，请刷新");
      if (!row.sessionId || !row.approvedAt)
        return { status: "pending" as const };
      const parent = await this.parent(tx, row.sessionId),
        token = key(),
        expiresAt = this.expiry(parent.expiresAt);
      const updated = await tx.healthScreenLogin.updateMany({
        where: {
          pollHash,
          sessionId: parent.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { viewHash: hash(token), consumedAt: new Date(), expiresAt },
      });
      if (updated.count !== 1) throw new GoneException("二维码已使用");
      return { status: "approved" as const, token, expiresAt };
    });
  }
  async resolve(token: string) {
    if (!chinaScreenSite() || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("请先登录会员");
    const row = await this.db.healthScreenLogin.findFirst({
      where: {
        viewHash: hash(token),
        consumedAt: { not: null },
        expiresAt: { gt: new Date() },
      },
      select: { sessionId: true },
    });
    if (!row?.sessionId) throw new UnauthorizedException("大屏登录已失效");
    const session = await this.parent(this.db, row.sessionId);
    return { id: session.userId, sessionId: session.id };
  }
  async cancel(poll: unknown) {
    await this.db.healthScreenLogin.deleteMany({
      where: { pollHash: checked(poll), consumedAt: null },
    });
    return { cancelled: true };
  }
  async logout(token: string) {
    await this.db.healthScreenLogin.deleteMany({
      where: { viewHash: checked(token) },
    });
    return { loggedOut: true };
  }
}
@Injectable()
export class MemberScreenGuard implements CanActivate {
  constructor(private readonly logins: MemberScreenLogin) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    req.authUser = await this.logins.resolve(
      (req.header("authorization") || "").replace(/^Bearer /, ""),
    );
    return true;
  }
}
