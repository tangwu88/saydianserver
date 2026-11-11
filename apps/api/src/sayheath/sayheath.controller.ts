import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Header,
  BadRequestException,
  ForbiddenException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AdminRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AdminAuthGuard, AdminRoles } from "../admin/admin-auth";
import { CurrentAdmin } from "../common/request-context";
import { PrismaService } from "../common/prisma.service";
import { normalizedEmail } from "../auth/global-identity";
import { RawResponse } from "../common/raw-response.decorator";
import { SayHeathService } from "./service";
import { featureKeys, release, requireUS, strictFeature } from "./policy";
type BodyMap = Record<string, unknown>;
const page = (title: string, html: string) =>
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
  title +
  " | SayHeath</title><style>body{max-width:46rem;margin:4rem auto;padding:0 1.3rem;color:#19342c;font:18px/1.6 system-ui}a{color:#146451}input,textarea,button{font:inherit}label{display:block;margin:1rem 0}</style><main><h1>" +
  title +
  "</h1>" +
  html +
  "</main></html>";
@Controller("api/saydian-app/v2/sayheath")
export class SayHeathController {
  constructor(
    private readonly svc: SayHeathService,
    private readonly db: PrismaService,
  ) {}
  @Get("legal") legal() {
    return this.svc.legal();
  }
  @Get("public/privacy")
  @RawResponse()
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
  @Header("Content-Type", "text/html; charset=utf-8")
  async privacy() {
    return page(
      "SayHeath Privacy Policy",
      (await this.svc.legal()).privacy.contentHtml,
    );
  }
  @Get("public/terms")
  @RawResponse()
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
  @Header("Content-Type", "text/html; charset=utf-8")
  async terms() {
    return page(
      "SayHeath Terms of Service",
      (await this.svc.legal()).terms.contentHtml,
    );
  }
  @Get("public/support")
  @RawResponse()
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
  @Header("Content-Type", "text/html; charset=utf-8")
  support() {
    requireUS();
    return page(
      "SayHeath Support",
      '<p>Contact Hong Kong Saydian Technology Limited about your account, device connection, sharing or privacy. Please do not include passwords or health readings.</p><form method="post" action="support"><label>Reply email <input type="email" name="email" required maxlength="254"></label><label>Message <textarea name="message" required maxlength="2000"></textarea></label><button>Send to support</button></form>',
    );
  }
  @Post("public/support")
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @RawResponse()
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
  @Header("Content-Type", "text/html; charset=utf-8")
  async feedback(@Body() b: BodyMap) {
    requireUS();
    const email = normalizedEmail(b.email),
      message = typeof b.message === "string" ? b.message.trim() : "";
    if (!email || !message || message.length > 2000)
      throw new BadRequestException();
    await this.db.feedback.create({
      data: { category: "sayheath_support", content: message, contact: email },
    });
    return page(
      "Message received",
      "<p>Thank you. Our support team can reply by email.</p>",
    );
  }
  @Get("public/account-deletion")
  @RawResponse()
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
  @Header("Content-Type", "text/html; charset=utf-8")
  deletion() {
    requireUS();
    return page(
      "Account deletion",
      '<p>In SayHeath open Account → Delete shared account. Confirm the request to schedule deletion in seven days. This affects all services using the same account. For help, <a href="support">contact support</a>.</p>',
    );
  }
  @Post("sign-in") @Throttle({ default: { limit: 12, ttl: 60000 } }) sign(
    @Body() b: BodyMap,
  ) {
    return this.svc.sign(b, false);
  }
  @Post("register") @Throttle({ default: { limit: 5, ttl: 60000 } }) register(
    @Body() b: BodyMap,
  ) {
    return this.svc.sign(b, true);
  }
  @Get("policy") @Header("Cache-Control", "no-store") policy(
    @Headers("authorization") a: string,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.policy(tx, await this.svc.session(a, tx)),
    );
  }
  @Post("permission") grant(
    @Headers("authorization") a: string,
    @Body() b: BodyMap,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.grant(tx, await this.svc.session(a, tx), b),
    );
  }
  @Post("captures") capture(
    @Headers("authorization") a: string,
    @Body() b: BodyMap,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.capture(tx, await this.svc.session(a, tx), b),
    );
  }
  @Post("captures/:id/reading") receive(
    @Headers("authorization") a: string,
    @Param("id") id: string,
    @Body() b: BodyMap,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.receive(tx, await this.svc.session(a, tx), id, b),
    );
  }
  @Get("captures/:id") @Header("Cache-Control", "no-store") reading(
    @Headers("authorization") a: string,
    @Param("id") id: string,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.reading(tx, await this.svc.session(a, tx), id),
    );
  }
  @Get("readings") @Header("Cache-Control", "no-store") readings(
    @Headers("authorization") a: string,
    @Query("feature") f: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.history(tx, await this.svc.session(a, tx), f, cursor),
    );
  }
  @Get("activity") @Header("Cache-Control", "no-store") activity(
    @Headers("authorization") a: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.activity(
        tx,
        (await this.svc.session(a, tx)).userId,
        ["activity", "sleep"],
        cursor,
      ),
    );
  }
  @Post("activity") daily(
    @Headers("authorization") a: string,
    @Body() b: BodyMap,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.saveDaily(tx, await this.svc.session(a, tx), b),
    );
  }
  @Get("family") @Header("Cache-Control", "no-store") family(
    @Headers("authorization") a: string,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.family(tx, await this.svc.session(a, tx)),
    );
  }
  @Post("family") invite(
    @Headers("authorization") a: string,
    @Body() b: BodyMap,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.invite(tx, await this.svc.session(a, tx), b),
    );
  }
  @Post("family/:id/:action") familyAction(
    @Headers("authorization") a: string,
    @Param("id") id: string,
    @Param("action") op: string,
    @Body() b: BodyMap,
  ) {
    return this.svc.transaction(async (tx) =>
      this.svc.familyAction(tx, await this.svc.session(a, tx), id, op, b),
    );
  }
  @Post("sign-out") async logout(@Headers("authorization") a: string) {
    return this.svc.transaction(async (tx) => {
      const s = await this.svc.session(a, tx);
      await tx.sayHeathSession.delete({ where: { id: s.id } });
      return { signedOut: true };
    });
  }
  @Post("delete-account") async remove(
    @Headers("authorization") a: string,
    @Body() b: BodyMap,
  ) {
    if (b.confirmSharedAccount !== true) throw new BadRequestException();
    return this.svc.deleteAccount(await this.svc.session(a));
  }
}
@Controller("api/saydian-app/admin/v1/settings/sayheath")
@UseGuards(AdminAuthGuard)
@AdminRoles(AdminRole.SUPER_ADMIN)
export class SayHeathAdminController {
  constructor(private readonly db: PrismaService) {}
  @Get("features") async features() {
    requireUS();
    const rows = await this.db.sayHeathSwitch.findMany({ where: { release } });
    return {
      release,
      items: featureKeys.map((feature) => ({
        feature,
        enabled: false,
        revision: null,
        ...rows.find((r) => r.feature === feature),
      })),
    };
  }
  @Post("features/:feature") async set(
    @CurrentAdmin() admin: { id: string; roles?: string[]; role: string },
    @Param("feature") name: string,
    @Body() b: BodyMap,
  ) {
    requireUS();
    if (![admin.role, ...(admin.roles ?? [])].includes("SUPER_ADMIN"))
      throw new ForbiddenException();
    const feature = strictFeature(name);
    if (typeof b.enabled !== "boolean" || b.release !== release)
      throw new BadRequestException();
    const enabled = b.enabled;
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"sayheath:" + release + ":" + feature},0))`;
      const key = { release, feature },
        old = await tx.sayHeathSwitch.findUnique({
          where: { release_feature: key },
        });
      if ((old?.revision ?? null) !== b.expectedRevision)
        throw new BadRequestException("Refresh before saving.");
      if (old && old.enabled === enabled) return old;
      const revision = randomUUID();
      const result = await tx.sayHeathSwitch.upsert({
        where: { release_feature: key },
        create: { ...key, enabled, revision },
        update: { enabled, revision },
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: admin.id,
          entityType: "SAYHEATH_FEATURE",
          entityId: release + ":" + feature,
          action: "SET_AVAILABILITY",
          beforeJson: { enabled: old?.enabled ?? false },
          afterJson: { enabled, revision },
        },
      });
      return result;
    });
  }
}
