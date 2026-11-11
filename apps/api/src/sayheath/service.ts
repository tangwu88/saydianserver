import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { compare, hash } from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import { normalizedEmail } from "../auth/global-identity";
import { AuthService } from "../auth/auth.service";
import {
  activityProjection,
  deviceKey,
  documents,
  featureKeys,
  parseValues,
  product,
  release,
  requireUS,
  sensors,
  strictFeature,
  type Feature,
} from "./policy";
type Db = Prisma.TransactionClient;
type Body = Record<string, unknown>;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const invalid = () => new BadRequestException("Check the submitted details.");
const denied = () =>
  new ForbiddenException("Permission is no longer available.");
const uuid = (v: unknown) => {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
  )
    throw invalid();
  return v;
};
type Session = {
  id: string;
  userId: string;
  release: string;
  legalVersion: string;
};
@Injectable()
export class SayHeathService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  async legal(db: Db = this.db) {
    requireUS();
    const rows = await db.globalLegalDocument.findMany({
      where: {
        documentType: { in: [...documents] },
        locale: "en",
        reviewed: true,
        active: true,
        publishedAt: { lte: new Date() },
      },
      orderBy: { publishedAt: "desc" },
      select: {
        documentType: true,
        version: true,
        contentHtml: true,
        title: true,
      },
    });
    const terms = rows.find((r) => r.documentType === documents[0]),
      privacy = rows.find((r) => r.documentType === documents[1]);
    if (
      !terms?.version ||
      !privacy ||
      terms.version !== privacy.version ||
      !terms.contentHtml.trim() ||
      !privacy.contentHtml.trim()
    )
      throw new ServiceUnavailableException(
        "SayHeath account documents are not available yet.",
      );
    return { product, release, version: terms.version, terms, privacy };
  }
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
  async sign(b: Body, register: boolean) {
    requireUS();
    const email = normalizedEmail(b.email),
      pass = b.password;
    if (
      !email ||
      typeof pass !== "string" ||
      !pass ||
      Buffer.byteLength(pass) > 72 ||
      (register && pass.length < 8) ||
      b.accepted !== true ||
      b.release !== release
    )
      throw invalid();
    if (
      register &&
      !/^(true|1)$/i.test(
        process.env.GLOBAL_UNVERIFIED_REGISTRATION_ENABLED ?? "",
      )
    )
      throw new ForbiddenException("Registration is not currently available.");
    const user = await this.db.user.findUnique({
      where: { email },
      select: { id: true, status: true, passwordHash: true },
    });
    if (
      !register &&
      (!user?.passwordHash ||
        user.status !== "ACTIVE" ||
        !(await compare(pass, user.passwordHash)))
    )
      throw new UnauthorizedException("Email or password is incorrect.");
    if (register && user)
      throw new ConflictException("Sign in to your existing account.");
    const passwordHash = register ? await hash(pass, 12) : undefined;
    return this.transaction(async (tx) => {
      const legal = await this.legal(tx);
      if (b.legalVersion !== legal.version)
        throw new ConflictException(
          "Please review the current terms and privacy policy.",
        );
      const account = register
        ? await tx.user.create({
            data: {
              email,
              passwordHash: passwordHash!,
              nickname: "SayHeath member",
              locale: "en",
            },
            select: { id: true },
          })
        : await tx.user.findFirst({
            where: {
              id: user!.id,
              status: "ACTIVE",
              passwordHash: user!.passwordHash,
            },
            select: { id: true },
          });
      if (!account) throw new UnauthorizedException();
      for (const documentType of documents)
        await tx.consentRecord.upsert({
          where: {
            userId_documentType_version: {
              userId: account.id,
              documentType,
              version: legal.version,
            },
          },
          create: {
            userId: account.id,
            documentType,
            version: legal.version,
            source: "sayheath:ios:en",
          },
          update: { withdrawnAt: null, source: "sayheath:ios:en" },
        });
      const sessionId = randomUUID(),
        token =
          "sh1." + sessionId + "." + randomBytes(32).toString("base64url"),
        expiresAt = new Date(Date.now() + 7 * 86400000);
      await tx.sayHeathSession.create({
        data: {
          userId: account.id,
          id: sessionId,
          tokenHash: digest(
            "sayheath/session/1:" +
              token +
              ":" +
              (passwordHash ?? user!.passwordHash),
          ),
          expiresAt,
          release,
          legalVersion: legal.version,
        },
      });
      return {
        token,
        userId: account.id,
        expiresAt: expiresAt.toISOString(),
        product,
        release,
      };
    });
  }
  async session(auth: string | undefined, db: Db = this.db): Promise<Session> {
    requireUS();
    const match =
      /^Bearer (sh1\.([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43})$/.exec(
        auth ?? "",
      );
    if (!match) throw new UnauthorizedException();
    const s = await db.sayHeathSession.findFirst({
      where: {
        id: match[2]!,
        expiresAt: { gt: new Date() },
        release,
        user: { status: "ACTIVE" },
      },
      select: {
        id: true,
        userId: true,
        release: true,
        legalVersion: true,
        tokenHash: true,
        user: { select: { passwordHash: true } },
      },
    });
    if (
      !s?.user.passwordHash ||
      !/^[a-f0-9]{64}$/.test(s.tokenHash) ||
      !timingSafeEqual(
        Buffer.from(s.tokenHash, "hex"),
        Buffer.from(
          digest("sayheath/session/1:" + match[1] + ":" + s.user.passwordHash),
          "hex",
        ),
      )
    )
      throw new UnauthorizedException();
    const legal = await this.legal(db);
    if (legal.version !== s.legalVersion)
      throw new UnauthorizedException("Review the updated documents.");
    const accepted = await db.consentRecord.count({
      where: {
        userId: s.userId,
        documentType: { in: [...documents] },
        version: s.legalVersion,
        withdrawnAt: null,
      },
    });
    if (accepted !== 2) throw new UnauthorizedException();
    return {
      id: s.id,
      userId: s.userId,
      release: s.release,
      legalVersion: s.legalVersion,
    };
  }
  async policy(tx: Db, s: Session) {
    const switches = await tx.sayHeathSwitch.findMany({
      where: { release: s.release },
    });
    const grants = await tx.sayHeathGrant.findMany({
      where: { userId: s.userId, release: s.release },
    });
    return {
      product,
      release: s.release,
      userId: s.userId,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      features: Object.fromEntries(
        featureKeys.map((k) => {
          const sw = switches.find((x) => x.feature === k);
          return [
            k,
            {
              enabled: sw?.enabled === true,
              consented:
                sw?.enabled === true &&
                grants.some(
                  (g) => g.feature === k && g.revision === sw.revision,
                ),
            },
          ];
        }),
      ),
    };
  }
  async grant(tx: Db, s: Session, b: Body) {
    const feature = strictFeature(b.feature),
      key = { userId: s.userId, release: s.release, feature };
    if (b.allow === false) {
      await tx.sayHeathGrant.deleteMany({ where: key });
      return this.policy(tx, s);
    }
    if (b.allow !== true) throw invalid();
    const sw = await tx.sayHeathSwitch.findUnique({
      where: { release_feature: { release: s.release, feature } },
    });
    if (!sw?.enabled) throw denied();
    const prior = await tx.sayHeathGrant.findUnique({
      where: { userId_release_feature: key },
    });
    if (prior?.revision !== sw.revision)
      await tx.sayHeathGrant.upsert({
        where: { userId_release_feature: key },
        create: { ...key, grantId: randomUUID(), revision: sw.revision },
        update: {
          grantId: randomUUID(),
          revision: sw.revision,
          acceptedAt: new Date(),
        },
      });
    return this.policy(tx, s);
  }
  async allowed(tx: Db, s: Session, feature: Feature) {
    const key = { release: s.release, feature };
    const sw = await tx.sayHeathSwitch.findUnique({
      where: { release_feature: key },
    });
    const grant = await tx.sayHeathGrant.findUnique({
      where: { userId_release_feature: { ...key, userId: s.userId } },
    });
    if (!sw?.enabled || !grant || grant.revision !== sw.revision)
      throw denied();
    return grant;
  }
  async capture(tx: Db, s: Session, b: Body) {
    const feature = strictFeature(b.feature);
    if (!sensors.some((k) => k === feature)) throw invalid();
    const grant = await this.allowed(tx, s, feature);
    return tx.sayHeathCapture.create({
      data: {
        userId: s.userId,
        release: s.release,
        deviceKey: deviceKey(b.deviceKey),
        feature,
        grantId: grant.grantId,
      },
      select: { id: true, startedAt: true, feature: true },
    });
  }
  async receive(tx: Db, s: Session, id: string, b: Body) {
    const row = await tx.sayHeathCapture.findFirst({
      where: {
        id: uuid(id),
        userId: s.userId,
        release: s.release,
        deviceKey: deviceKey(b.deviceKey),
      },
    });
    if (!row) throw new NotFoundException();
    const feature = strictFeature(row.feature),
      grant = await this.allowed(tx, s, feature);
    if (row.grantId !== grant.grantId || b.feature !== feature) throw denied();
    const at = new Date(String(b.observedAt)),
      values = parseValues(feature, b.values, b.unit);
    if (
      !Number.isFinite(+at) ||
      +at < +row.startedAt ||
      +at > +row.startedAt + 4 * 60000 ||
      +at > Date.now() + 5000
    )
      throw invalid();
    if (row.observedAt) {
      if (
        +row.observedAt !== +at ||
        row.unit !== b.unit ||
        !Object.entries(values).every(
          ([k, v]) => (row.values as Record<string, unknown>)?.[k] === v,
        )
      )
        throw new ConflictException(
          "Reading already received with different contents.",
        );
    } else
      await tx.sayHeathCapture.update({
        where: { id: row.id },
        data: { observedAt: at, values, unit: String(b.unit) },
      });
    return {
      id: row.id,
      received: true,
      feature,
      observedAt: at.toISOString(),
      values,
      unit: b.unit,
    };
  }
  async reading(tx: Db, s: Session, id: string) {
    const row = await tx.sayHeathCapture.findFirst({
      where: {
        id: uuid(id),
        userId: s.userId,
        release: s.release,
        observedAt: { not: null },
      },
      select: {
        id: true,
        feature: true,
        observedAt: true,
        values: true,
        unit: true,
      },
    });
    if (!row) throw new NotFoundException();
    await this.allowed(tx, s, strictFeature(row.feature));
    return row;
  }
  async history(tx: Db, s: Session, featureValue: unknown, cursor?: string) {
    const feature = strictFeature(featureValue);
    if (!sensors.some((k) => k === feature)) throw invalid();
    await this.allowed(tx, s, feature);
    return tx.sayHeathCapture.findMany({
      where: { userId: s.userId, feature, observedAt: { not: null } },
      select: {
        id: true,
        feature: true,
        observedAt: true,
        values: true,
        unit: true,
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      take: 100,
      ...(cursor ? { cursor: { id: uuid(cursor) }, skip: 1 } : {}),
    });
  }
  async activity(tx: Db, userId: string, features: string[], cursor?: string) {
    const metrics: ("STEPS" | "SLEEP")[] = [];
    if (features.includes("activity")) metrics.push("STEPS");
    if (features.includes("sleep")) metrics.push("SLEEP");
    const rows = await tx.healthRecord.findMany({
      where: {
        userId,
        metric: { in: metrics },
        OR: [{ aggregationKind: null }, { aggregationActive: true }],
        quality: { not: "INVALID" },
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      take: 100,
      ...(cursor ? { cursor: { id: uuid(cursor) }, skip: 1 } : {}),
      select: {
        id: true,
        metric: true,
        observedAt: true,
        unit: true,
        values: true,
        aggregationLocalDate: true,
      },
    });
    return {
      items: rows.map(activityProjection).filter((x) => x !== null),
      next: rows.length === 100 ? rows.at(-1)!.id : null,
    };
  }
  async saveDaily(tx: Db, s: Session, b: Body) {
    const f = b.feature;
    if (f !== "activity" && f !== "sleep") throw invalid();
    const local = String(b.localDate),
      at = new Date(String(b.observedAt)),
      v = b.value,
      offset = b.offset;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(local) ||
      !Number.isFinite(+at) ||
      +at > Date.now() + 60000 ||
      !Number.isInteger(offset) ||
      Math.abs(Number(offset)) > 840 ||
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v <= 0 ||
      (f === "activity" ? !Number.isInteger(v) || v > 1000000 : v > 1440)
    )
      throw invalid();
    const day = new Date(local + "T00:00:00Z");
    if (
      !Number.isFinite(+day) ||
      day.toISOString().slice(0, 10) !== local ||
      Math.abs(+at + Number(offset) * 60000 - +day) > 2 * 86400000
    )
      throw invalid();
    const device = deviceKey(b.deviceKey),
      id = "sayheath.daily." + digest([device, local, f, v].join(":")),
      metric = f === "activity" ? "STEPS" : "SLEEP";
    const old = await tx.healthRecord.findUnique({
      where: {
        userId_clientRecordId: { userId: s.userId, clientRecordId: id },
      },
    });
    if (old) return { id: old.id, received: true };
    const scope = {
      userId: s.userId,
      metric: metric as "STEPS" | "SLEEP",
      sourceDeviceKey: device,
      aggregationKind: "daily_summary",
      aggregationLocalDate: local,
    };
    const previous = await tx.healthRecord.findFirst({
      where: { ...scope, aggregationActive: true },
      orderBy: { observedAt: "desc" },
    });
    const active = !previous || +previous.observedAt <= +at;
    if (active && previous)
      await tx.healthRecord.update({
        where: { id: previous.id },
        data: { aggregationActive: false },
      });
    const row = await tx.healthRecord.create({
      data: {
        ...scope,
        aggregationActive: active,
        clientRecordId: id,
        observedAt: at,
        timezoneOffsetMinutes: Number(offset),
        sourcePlatform: "ios",
        sourceOrigin: "watchHistory",
        sourceMeasurementSource: "wearable",
        values: f === "activity" ? { steps: v } : { durationMinutes: v },
        unit: f === "activity" ? "steps" : "min",
      },
    });
    return { id: row.id, received: true };
  }
  async family(tx: Db, s: Session) {
    const rows = await tx.sayHeathFamily.findMany({
      where: { OR: [{ ownerId: s.userId }, { viewerId: s.userId }] },
      include: {
        owner: { select: { email: true } },
        viewer: { select: { email: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      owner: r.ownerId === s.userId,
      other: r.ownerId === s.userId ? r.viewer.email : r.owner.email,
      activity: r.activity,
      sleep: r.sleep,
      acceptedActivity: r.acceptedActivity,
      acceptedSleep: r.acceptedSleep,
    }));
  }
  async invite(tx: Db, s: Session, b: Body) {
    if (
      typeof b.activity !== "boolean" ||
      typeof b.sleep !== "boolean" ||
      (!b.activity && !b.sleep)
    )
      throw invalid();
    const other = await tx.user.findFirst({
      where: { email: normalizedEmail(b.email), status: "ACTIVE" },
      select: { id: true },
    });
    if (!other || other.id === s.userId) throw invalid();
    return tx.sayHeathFamily.create({
      data: {
        ownerId: s.userId,
        viewerId: other.id,
        activity: b.activity,
        sleep: b.sleep,
      },
      select: { id: true },
    });
  }
  async familyAction(tx: Db, s: Session, id: string, action: string, b: Body) {
    const row = await tx.sayHeathFamily.findFirst({
      where: {
        owner: { status: "ACTIVE" },
        viewer: { status: "ACTIVE" },
        id: uuid(id),
        OR: [{ ownerId: s.userId }, { viewerId: s.userId }],
      },
    });
    if (!row) throw new NotFoundException();
    if (action === "end") {
      await tx.sayHeathFamily.delete({ where: { id: row.id } });
      return { ended: true };
    }
    if (action === "read") {
      if (row.viewerId !== s.userId) throw denied();
      const categories = [
        ...(row.activity && row.acceptedActivity ? ["activity"] : []),
        ...(row.sleep && row.acceptedSleep ? ["sleep"] : []),
      ];
      if (!categories.length) throw denied();
      return this.activity(
        tx,
        row.ownerId,
        categories,
        typeof b.cursor === "string" ? b.cursor : undefined,
      );
    }
    if (typeof b.activity !== "boolean" || typeof b.sleep !== "boolean")
      throw invalid();
    if (action === "offer" && row.ownerId === s.userId)
      await tx.sayHeathFamily.update({
        where: { id: row.id },
        data: {
          activity: b.activity,
          sleep: b.sleep,
          acceptedActivity: b.activity && row.acceptedActivity,
          acceptedSleep: b.sleep && row.acceptedSleep,
        },
      });
    else if (
      action === "accept" &&
      row.viewerId === s.userId &&
      (!b.activity || row.activity) &&
      (!b.sleep || row.sleep)
    )
      await tx.sayHeathFamily.update({
        where: { id: row.id },
        data: { acceptedActivity: b.activity, acceptedSleep: b.sleep },
      });
    else throw denied();
    return { saved: true };
  }
  deleteAccount(s: Session) {
    return this.auth.requestAccountDeletion(s.userId);
  }
}
