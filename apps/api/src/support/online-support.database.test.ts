import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { sign } from "jsonwebtoken";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "../common/crypto";
import { authAudience, authIssuer } from "../common/deployment-realm";
import type { PrismaService } from "../common/prisma.service";
import { SupportConversations } from "./support-conversations";
import { SupportContent } from "./support-content";
import type { SupportAi } from "./support-ai";
import { syncDiagnosticCategory } from "./sync-diagnostics";

// Run against freshly migrated synthetic fixtures only. Start compiled Nest so
// the real decorator metadata, /global alias, guards and SSE pipeline run.
describe.runIf(process.env.RUN_SAY_RING_SUPPORT_DATABASE_TESTS === "1")(
  "online support loopback HTTP and PostgreSQL",
  () => {
    const base = "/global/api/saydian-app/v2/support";
    const adminBase = "/api/saydian-app/admin/v1/support-chat";
    const secret = randomUUID() + randomUUID();
    const seed = "SYNTHETIC_SUPPORT_" + randomUUID();
    const configKey = "say_ring_online_support";
    let prisma: PrismaClient, child: ChildProcess | undefined;
    let root: string,
      member: string,
      foreign: string,
      staff: string,
      alternate: string,
      forbidden: string;
    let chinese: string,
      english: string,
      published: string,
      draft: string,
      other: string,
      translated: string;
    const users: string[] = [],
      admins: string[] = [],
      categories: string[] = [],
      articles: string[] = [],
      guests: string[] = [];
    const outboxThreads: string[] = [];
    const controllers = new Set<AbortController>();
    const diagnostic = {
      schemaVersion: 2,
      product: "say-ring",
      reportId: randomUUID(),
      connectionId: randomUUID(),
      mode: "automatic",
      platform: "android",
      appVersion: "1.0.14",
      buildNumber: 1308,
      osMajor: 10,
      sdk: "qring",
      model: "R8",
      firmware: "1.2.3",
      connectionState: "ready",
      initializationState: "ready",
      capabilityState: "ready",
      metrics: ["heart_rate"],
      connectionKind: "automatic_recovery",
      phone: {
        brand: "HUAWEI",
        modelId: "PPA-LX3",
        osVersion: "10.1",
        osBuild: "R1",
        apiLevel: 29,
        locale: "en",
      },
      stages: [
        { stage: "connect", state: "ok", code: "none", elapsedMs: 1650 },
      ],
    };

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        url.hostname !== "127.0.0.1" ||
        url.username !== "sayring_qa" ||
        !["/postgres", "/say_ring_support_test"].includes(url.pathname)
      )
        throw Error("Dedicated Say Ring QA database required");
      prisma = new PrismaClient();
      if (await prisma.appSetting.findUnique({ where: { key: configKey } }))
        throw Error("Use an empty support QA configuration");
      const socket = createServer();
      await new Promise<void>((ok, reject) =>
        socket.once("error", reject).listen(0, "127.0.0.1", ok),
      );
      const port = (socket.address() as { port: number }).port;
      await new Promise<void>((ok, reject) =>
        socket.close((e) => (e ? reject(e) : ok())),
      );
      root = "http://127.0.0.1:" + port;
      let log = "";
      child = spawn(process.execPath, [resolve("dist/main.js")], {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: process.env.DATABASE_URL,
          NODE_ENV: "test",
          HOST: "127.0.0.1",
          PORT: String(port),
          ACCESS_TOKEN_SECRET: secret,
          WORKER_PAUSED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stderr?.on("data", (value) => {
        log = (log + String(value)).slice(-7_000);
      });
      child.stdout?.on("data", (value) => {
        log = (log + String(value)).slice(-7_000);
      });
      let started = false;
      for (let i = 0; i < 80; i++) {
        try {
          started = (
            await fetch(root + base + "/online-config", {
              signal: AbortSignal.timeout(300),
            })
          ).ok;
          if (started) break;
        } catch {
          /* Wait for real listener. */
        }
        if (child.exitCode !== null) break;
        await delay(100);
      }
      if (!started)
        throw Error(
          "Unable to start the isolated API. Build app-api first.\n" + log,
        );
      member = await user();
      foreign = await user();
      staff = await operator("CUSTOMER_SERVICE");
      alternate = await operator("CUSTOMER_SERVICE");
      forbidden = await operator("FINANCE");
      chinese = await category("zh-Hans");
      english = await category("en");
      published = await article(
        chinese,
        "zh-Hans",
        "say-ring",
        "PUBLISHED",
        "蓝牙重新连接",
      );
      draft = await article(
        chinese,
        "zh-Hans",
        "say-ring",
        "DRAFT",
        "蓝牙草稿",
      );
      other = await article(
        chinese,
        "zh-Hans",
        "saidian",
        "PUBLISHED",
        "蓝牙其他产品",
      );
      translated = await article(
        english,
        "en",
        "shared",
        "DRAFT",
        "Bluetooth connection",
      );
    }, 20_000);

    afterAll(async () => {
      for (const ctrl of controllers) ctrl.abort();
      if (child?.exitCode === null) {
        const exits = new Promise<void>((done) =>
          child!.once("exit", () => done()),
        );
        child.kill("SIGTERM");
        await Promise.race([
          exits,
          delay(2200).then(() => {
            if (child?.exitCode === null) child.kill("SIGKILL");
          }),
        ]);
      }
      if (!prisma) return;
      if (admins.length) {
        await prisma.auditLog.deleteMany({
          where: { actorId: { in: admins } },
        });
        await prisma.appSetting.deleteMany({ where: { key: configKey } });
      }
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: "support_conversation",
          aggregateId: { in: outboxThreads },
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.supportGuest.deleteMany({ where: { id: { in: guests } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: admins } } });
      await prisma.article.deleteMany({ where: { id: { in: articles } } });
      await prisma.articleCategory.deleteMany({
        where: { id: { in: categories } },
      });
      await prisma.$disconnect();
    });

    async function user() {
      const u = await prisma.user.create({ data: { nickname: seed } });
      users.push(u.id);
      const jti = randomUUID(),
        expiresAt = new Date(Date.now() + 3600_000);
      const session = await prisma.userSession.create({
        data: {
          userId: u.id,
          accessJti: jti,
          refreshTokenHash: sha256(randomUUID()),
          expiresAt,
        },
      });
      return sign({ typ: "access", sid: session.id }, secret, {
        subject: u.id,
        jwtid: jti,
        issuer: authIssuer(),
        audience: authAudience(),
        expiresIn: "1h",
      });
    }
    async function operator(
      role: "CUSTOMER_SERVICE" | "FINANCE" | "APP_OPERATIONS",
    ) {
      const admin = await prisma.adminUser.create({
        data: {
          username: seed + randomUUID(),
          displayName: seed,
          passwordHash: "fixture-only",
          role,
        },
      });
      admins.push(admin.id);
      const token = randomUUID() + randomUUID();
      await prisma.adminSession.create({
        data: {
          adminId: admin.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      return token;
    }
    async function category(locale: string) {
      const row = await prisma.articleCategory.create({
        data: { name: seed, locale },
      });
      categories.push(row.id);
      return row.id;
    }
    async function article(
      categoryId: string,
      locale: string,
      product: string,
      status: string,
      title: string,
    ) {
      const row = await prisma.article.create({
        data: {
          categoryId,
          locale,
          product,
          status,
          title,
          publishedAt: new Date(2026, 0, 1),
          contentHtml:
            '<p>重试连接</p><script>discard_this</script><img src="https://outside.example/image.jpg">',
        },
      });
      articles.push(row.id);
      return row.id;
    }
    async function raw(
      path: string,
      token?: string,
      body?: unknown,
      opts: { method?: string; locale?: string; signal?: AbortSignal } = {},
    ) {
      const headers: Record<string, string> = {
        "accept-language": opts.locale ?? "en",
      };
      if (token) headers.authorization = "Bearer " + token;
      if (body !== undefined && !(body instanceof FormData))
        headers["content-type"] = "application/json";
      return fetch(root + path, {
        method: opts.method ?? (body === undefined ? "GET" : "POST"),
        headers,
        body:
          body === undefined
            ? null
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
        signal: opts.signal ?? AbortSignal.timeout(4000),
      });
    }
    async function json(
      path: string,
      token?: string,
      body?: unknown,
      opts: { method?: string; locale?: string } = {},
    ) {
      const response = await raw(path, token, body, opts);
      const payload = await response.json();
      if (!response.ok || payload.code !== 200)
        throw Error(response.status + " " + JSON.stringify(payload));
      return payload.data;
    }
    async function newGuest() {
      const payload = await json(base + "/guest", undefined, {});
      const x = await prisma.supportGuest.findUniqueOrThrow({
        where: { tokenHash: sha256(payload.token as string) },
      });
      guests.push(x.id);
      return payload as { token: string; conversation: { id: string } };
    }
    async function stream(path: string, token: string) {
      const ctrl = new AbortController();
      controllers.add(ctrl);
      const response = await raw(path, token, undefined, {
        signal: ctrl.signal,
      });
      expect(response.headers.get("x-accel-buffering")).toBe("no");
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const reader = response
        .body!.pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      async function until(predicate: (v: any) => boolean) {
        const timeout = setTimeout(() => ctrl.abort(), 3000);
        try {
          while (true) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary < 0) {
              const entry = await reader.read();
              if (entry.done) throw Error("SSE ended before expected event");
              buffer += entry.value;
              continue;
            }
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (event.startsWith("data: ")) {
              const value = JSON.parse(event.slice(6));
              if (predicate(value)) return value;
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      }
      return {
        until,
        stop: () => {
          ctrl.abort();
          controllers.delete(ctrl);
        },
      };
    }

    it("feature off is compatible; only permitted admins configure bilingual published scope", async () => {
      expect(await json(base + "/online-config")).toMatchObject({
        product: "say-ring",
        enabled: false,
        whatsapp: null,
      });
      expect((await raw(base + "/guest", undefined, {})).status).toBe(503);
      const ops = await operator("APP_OPERATIONS");
      const config = {
        enabled: true,
        whatsappEnabled: true,
        whatsapp: "+12025550123",
        faqCategories: { "zh-Hans": chinese, en: english },
        guideCategoryIds: [chinese],
      };
      expect(
        (await raw(adminBase + "/config", staff, config, { method: "PUT" }))
          .status,
      ).toBe(403);
      expect(
        (
          await raw(
            adminBase + "/config",
            ops,
            {
              ...config,
              whatsapp: "https://wa.me@outside.example/12025550123",
            },
            { method: "PUT" },
          )
        ).status,
      ).toBe(400);
      await json(adminBase + "/config", ops, config, { method: "PUT" });
      expect(await json(base + "/online-config")).toMatchObject({
        enabled: true,
        whatsapp: "https://wa.me/12025550123",
      });
      expect(
        await json(base + "/online-config", undefined, undefined, {
          locale: "zh-CN",
        }),
      ).toMatchObject({ whatsapp: null });
      const fallback = await json(
        base + "/faq?q=" + encodeURIComponent("蓝牙"),
      );
      expect(fallback.locale).toBe("zh-Hans");
      expect(fallback.items.map((item: { id: string }) => item.id)).toEqual([
        published,
      ]);
      expect((await raw(base + "/faq/" + draft)).status).toBe(404);
      expect((await raw(base + "/faq/" + other)).status).toBe(404);
      const open = await json(base + "/faq/" + published);
      expect(open.contentHtml).toContain("重试连接");
      expect(open.contentHtml).not.toMatch(/outside|discard_this/);
      await prisma.article.update({
        where: { id: translated },
        data: { status: "PUBLISHED" },
      });
      expect((await json(base + "/faq?q=Bluetooth")).items[0].id).toBe(
        translated,
      );
      await prisma.article.update({
        where: { id: translated },
        data: { status: "ARCHIVED" },
      });
      expect((await json(base + "/faq?q=no_such_faq")).items).toEqual([]);
      expect((await raw(base + "/faq/" + translated)).status).toBe(404);
    });

    it("isolates guest threads, replays committed idempotent messages, and protects photos", async () => {
      const a = await newGuest(),
        b = await newGuest();
      const id = a.conversation.id,
        path = base + "/conversations/" + id;
      expect((await raw(path, b.token)).status).toBe(404);
      expect((await raw(path, member)).status).toBe(404);
      const message = {
        clientMessageId: randomUUID(),
        body: "Ring search",
        aiAllowed: true,
      };
      const results = await Promise.all([
        json(path + "/messages", a.token, message),
        json(path + "/messages", a.token, message),
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect((await json(path + "?after=0", a.token)).messages).toHaveLength(1);
      expect(
        (
          await raw(path + "/messages", a.token, {
            ...message,
            body: "different",
          })
        ).status,
      ).toBe(409);
      const png = await sharp({
        create: { width: 12, height: 12, channels: 3, background: "#268897" },
      })
        .png()
        .toBuffer();
      const picture = new FormData();
      picture.append("clientMessageId", randomUUID());
      picture.append(
        "file",
        new Blob([Uint8Array.from(png)], { type: "image/png" }),
        "test-only.png",
      );
      const photo = await json(path + "/attachments", a.token, picture);
      const object = path + "/attachments/" + photo.attachment.id;
      expect((await raw(object)).status).toBe(401);
      expect((await raw(object, b.token)).status).toBe(404);
      expect(
        (
          await raw(
            adminBase +
              "/conversations/" +
              id +
              "/attachments/" +
              photo.attachment.id,
            forbidden,
          )
        ).status,
      ).toBe(403);
      const response = await raw(object, a.token);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(
        (await sharp(new Uint8Array(await response.arrayBuffer())).metadata())
          .format,
      ).toBe("jpeg");
      expect(await json(path + "/diagnostic", a.token, diagnostic)).toEqual({
        accepted: true,
      });
      expect(
        (await json(path + "?after=1", a.token)).messages.map(
          (m: { seq: number }) => m.seq,
        ),
      ).toEqual([2]);
      expect(
        (await json(path + "/claim", member, { guestToken: a.token })).id,
      ).toBe(id);
      expect((await raw(path, a.token)).status).toBe(404);
      expect((await raw(path, foreign)).status).toBe(404);
      expect((await raw(object, member)).status).toBe(200);
      expect(
        (await json(adminBase + "/conversations/" + id + "/diagnostics", staff))
          .reports[0].report.phone.modelId,
      ).toBe("PPA-LX3");
      expect(
        (await raw(base + "/conversations/" + b.conversation.id, b.token))
          .status,
      ).toBe(200);
      outboxThreads.push(id);
    });

    it("delivers both human directions over SSE within 2s and suppresses an AI reply already in flight", async () => {
      // Earlier fixtures should have no runnable AI messages. The production
      // worker in the spawned API is paused; drive just this claim deterministically.
      const firstStarted = await json(base + "/conversations", foreign, {});
      const alsoStarted = await json(base + "/conversations", foreign, {});
      expect(firstStarted.id).toBe(alsoStarted.id);
      const id = firstStarted.id as string;
      outboxThreads.push(id);
      const app = base + "/conversations/" + id,
        desk = adminBase + "/conversations/" + id;
      expect((await raw(desk, forbidden)).status).toBe(403);
      const first = await json(app + "/messages", foreign, {
        clientMessageId: randomUUID(),
        body: "Can I find my ring?",
        aiAllowed: true,
      });
      let sendLate!: (data: { body: string; sources: [] }) => void,
        started!: () => void;
      const pending = new Promise<{ body: string; sources: [] }>((done) => {
        sendLate = done;
      });
      const entered = new Promise<void>((done) => {
        started = done;
      });
      const fixture = prisma as PrismaService;
      const runner = new SupportConversations(
        fixture,
        new SupportContent(fixture),
        {
          answer: async () => {
            started();
            return pending;
          },
        } as unknown as SupportAi,
      );
      const work = runner.runAi();
      try {
        const job = await Promise.race([
          entered.then(() => true),
          delay(1500).then(() => false),
        ]);
        expect(job).toBe(true);
        expect((await json(app + "/handoff", foreign, {})).state).toBe(
          "waiting",
        );
        expect(
          await json(desk + "/read", alternate, { seq: first.seq }),
        ).toEqual({ read: false });
        expect(
          (await json(adminBase + "/queues?filter=waiting", staff)).items,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id, unread: true }),
          ]),
        );
        expect(
          (await json(desk + "/transition", staff, { action: "accept" })).state,
        ).toBe("human");
        sendLate({ body: "This late AI reply must be dropped", sources: [] });
        await work;
        expect(
          await prisma.supportMessage.count({
            where: { conversationId: id, sender: "ai" },
          }),
        ).toBe(0);
        const received = await stream(
          app + "/events?after=" + first.seq,
          foreign,
        );
        const workbench = await stream(
          desk + "/events?after=" + first.seq,
          staff,
        );
        try {
          const start = performance.now();
          const second = await json(app + "/messages", foreign, {
            clientMessageId: randomUUID(),
            body: "Customer follow-up",
            aiAllowed: true,
          });
          await workbench.until((v) =>
            v.messages.some((m: { id: string }) => m.id === second.id),
          );
          const customerMs = performance.now() - start;
          expect(customerMs).toBeLessThan(2000);
          const send = performance.now();
          const reply = await json(desk + "/messages", staff, {
            clientMessageId: randomUUID(),
            body: "Human reply",
          });
          await received.until((v) =>
            v.messages.some((m: { id: string }) => m.id === reply.id),
          );
          const agentMs = performance.now() - send;
          expect(agentMs).toBeLessThan(2000);
          console.info(
            "Support SSE synthetic receipt delay (ms)",
            Math.round(customerMs),
            Math.round(agentMs),
          );
          const notification = await prisma.notification.findUniqueOrThrow({
            where: {
              userId_eventId: {
                userId: users[1]!,
                eventId: "support-reply:" + reply.id,
              },
            },
          });
          expect(notification.deepLink).toBe("/support/conversations/" + id);
          expect(notification.body).not.toContain("Human reply");
          expect(
            (await json(app + "?after=" + second.seq, foreign)).messages.map(
              (m: { id: string }) => m.id,
            ),
          ).toEqual([reply.id]);
          await json(desk + "/transition", staff, {
            action: "transfer",
            assignee: admins[1],
          });
          expect(
            (
              await raw(desk + "/messages", staff, {
                clientMessageId: randomUUID(),
                body: "obsolete assignee",
              })
            ).status,
          ).toBe(409);
          expect(
            (await json(desk + "/transition", alternate, { action: "close" }))
              .state,
          ).toBe("closed");
        } finally {
          received.stop();
          workbench.stop();
        }
      } finally {
        sendLate({ body: "late", sources: [] });
        await work;
      }
    });

    it("negotiates V2 without breaking old V1 reports or crossing accounts", async () => {
      const config = await json(
        base + "/sync-diagnostics/config?product=say-ring",
        member,
      );
      expect(config).toMatchObject({
        schemaVersion: 1,
        acceptedSchemaVersions: [1, 2],
      });
      expect(
        await json(base + "/sync-diagnostics", member, diagnostic),
      ).toMatchObject({ accepted: true });
      const { phone: _, connectionKind: __, ...old } = diagnostic;
      expect(
        await json(base + "/sync-diagnostics", member, {
          ...old,
          schemaVersion: 1,
          reportId: randomUUID(),
        }),
      ).toMatchObject({ accepted: true });
      expect(
        (
          await raw(base + "/sync-diagnostics", member, {
            ...diagnostic,
            phone: { ...diagnostic.phone, imei: "synthetic" },
          })
        ).status,
      ).toBe(400);
      const memberSlot = await prisma.feedback.findFirstOrThrow({
        where: { userId: users[0]!, category: syncDiagnosticCategory },
      });
      expect(
        JSON.parse(memberSlot.content).reports.map(
          (item: { report: { schemaVersion: number } }) =>
            item.report.schemaVersion,
        ),
      ).toEqual([1, 2]);
      expect(
        await prisma.feedback.count({
          where: { userId: users[1]!, category: syncDiagnosticCategory },
        }),
      ).toBe(0);
    });
  },
);
