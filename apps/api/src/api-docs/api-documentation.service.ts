import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ApiDocumentationStatus,
  Prisma,
} from "@prisma/client";
import { apiCatalog } from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";

type CatalogRoute = (typeof apiCatalog.routes)[number];

@Injectable()
export class ApiDocumentationService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const annotations = await this.prisma.apiDocumentationAnnotation.findMany();
    const byRoute = new Map(annotations.map((item) => [item.routeKey, item]));
    return {
      schemaVersion: apiCatalog.schemaVersion,
      routeDigest: currentRouteDigest(),
      items: apiCatalog.routes.map((route) => {
        const signatureHash = routeSignature(route);
        const annotation = byRoute.get(route.key);
        return {
          routeKey: route.key,
          method: route.method,
          path: route.path,
          auth: route.auth,
          roles: route.roles,
          parameters: route.parameters,
          envelope: route.envelope,
          source: route.source,
          title: annotation?.title || route.summary,
          summary: annotation?.summary || route.summary,
          businessExample: sanitizeExample(annotation?.businessExample ?? null),
          errorGuidance: sanitizeExample(annotation?.errorGuidance ?? null),
          tags: annotation?.tags ?? [],
          deprecated: annotation?.deprecated ?? false,
          deprecationNote: annotation?.deprecationNote ?? null,
          signatureHash,
          stale: Boolean(annotation && annotation.signatureHash !== signatureHash),
          draftRevision: annotation?.draftRevision ?? 0,
          publishedRevision: annotation?.publishedRevision ?? null,
        };
      }),
    };
  }

  async update(adminId: string, routeKey: string, input: unknown) {
    const route = findRoute(routeKey);
    const body = safeObject(input);
    const title = cleanText(body.title ?? route.summary, 120);
    const summary = cleanText(body.summary ?? route.summary, 1_000);
    if (!title || !summary) throw new BadRequestException("接口标题和说明不能为空");
    const tags = Array.isArray(body.tags)
      ? body.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 12)
      : [];
    return this.prisma.apiDocumentationAnnotation.upsert({
      where: { routeKey },
      create: {
        routeKey,
        signatureHash: routeSignature(route),
        title,
        summary,
        businessExample: sanitizeInputJson(body.businessExample),
        errorGuidance: sanitizeInputJson(body.errorGuidance),
        tags,
        deprecated: body.deprecated === true,
        deprecationNote: body.deprecationNote
          ? cleanText(body.deprecationNote, 500)
          : null,
        createdById: adminId,
        updatedById: adminId,
      },
      update: {
        signatureHash: routeSignature(route),
        title,
        summary,
        businessExample: sanitizeInputJson(body.businessExample),
        errorGuidance: sanitizeInputJson(body.errorGuidance),
        tags,
        deprecated: body.deprecated === true,
        deprecationNote: body.deprecationNote
          ? cleanText(body.deprecationNote, 500)
          : null,
        draftRevision: { increment: 1 },
        updatedById: adminId,
      },
    });
  }

  releases() {
    return this.prisma.apiDocumentationRelease.findMany({
      orderBy: { version: "desc" },
      take: 100,
    });
  }

  async createRelease(adminId: string, input: unknown) {
    const body = safeObject(input);
    const changeNote = cleanText(body.changeNote, 500);
    if (!changeNote) throw new BadRequestException("请填写本次文档变更说明");
    const docs = await this.list();
    const stale = docs.items.filter((item) => item.stale);
    if (stale.length) {
      throw new ConflictException("存在路由已变化的说明，请先复核并保存");
    }
    return this.prisma.apiDocumentationRelease.create({
      data: {
        routeDigest: docs.routeDigest,
        snapshot: docs as unknown as Prisma.InputJsonValue,
        changeNote,
        createdById: adminId,
      },
    });
  }

  async submitRelease(id: string) {
    const changed = await this.prisma.apiDocumentationRelease.updateMany({
      where: { id, status: ApiDocumentationStatus.DRAFT },
      data: { status: ApiDocumentationStatus.IN_REVIEW },
    });
    if (!changed.count) throw new ConflictException("只有草稿可以提交审核");
    return this.prisma.apiDocumentationRelease.findUniqueOrThrow({ where: { id } });
  }

  async publishRelease(adminId: string, id: string) {
    const release = await this.prisma.apiDocumentationRelease.findUnique({
      where: { id },
    });
    if (!release) throw new NotFoundException("文档版本不存在");
    if (release.status !== ApiDocumentationStatus.IN_REVIEW) {
      throw new ConflictException("只有审核中的版本可以发布");
    }
    if (release.routeDigest !== currentRouteDigest()) {
      throw new ConflictException("代码路由已变化，请重新生成文档版本");
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.apiDocumentationRelease.updateMany({
        where: { status: ApiDocumentationStatus.PUBLISHED },
        data: { status: ApiDocumentationStatus.ARCHIVED },
      });
      const published = await tx.apiDocumentationRelease.update({
        where: { id },
        data: {
          status: ApiDocumentationStatus.PUBLISHED,
          reviewedById: adminId,
          publishedAt: now,
        },
      });
      const annotations = await tx.apiDocumentationAnnotation.findMany({
        select: { id: true, draftRevision: true },
      });
      for (const annotation of annotations) {
        await tx.apiDocumentationAnnotation.update({
          where: { id: annotation.id },
          data: { publishedRevision: annotation.draftRevision },
        });
      }
      return published;
    });
  }

  async rollback(adminId: string, sourceId: string, input: unknown) {
    const source = await this.prisma.apiDocumentationRelease.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw new NotFoundException("要恢复的文档版本不存在");
    if (source.routeDigest !== currentRouteDigest()) {
      throw new ConflictException("历史文档与当前代码路由不一致，不能直接恢复");
    }
    const note = cleanText(safeObject(input).changeNote, 500) || `恢复到版本 ${source.version}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.apiDocumentationRelease.updateMany({
        where: { status: ApiDocumentationStatus.PUBLISHED },
        data: { status: ApiDocumentationStatus.ARCHIVED },
      });
      return tx.apiDocumentationRelease.create({
        data: {
          status: ApiDocumentationStatus.PUBLISHED,
          routeDigest: source.routeDigest,
          snapshot: source.snapshot as Prisma.InputJsonValue,
          changeNote: note,
          createdById: adminId,
          reviewedById: adminId,
          publishedAt: new Date(),
        },
      });
    });
  }

  async export(formatInput?: string) {
    const release = await this.prisma.apiDocumentationRelease.findFirst({
      where: { status: ApiDocumentationStatus.PUBLISHED },
      orderBy: { version: "desc" },
    });
    const docs = release ? safeObject(release.snapshot) : await this.list();
    const items = Array.isArray(docs.items) ? docs.items.map(safeObject) : [];
    const format = String(formatInput ?? "markdown").toLowerCase();
    if (format === "openapi") {
      const paths: Record<string, Record<string, unknown>> = {};
      for (const route of items) {
        const path = String(route.path ?? "");
        const method = String(route.method ?? "get").toLowerCase();
        const entry = paths[path] ?? {};
        entry[method] = {
          summary: route.title,
          description: route.summary,
          tags: route.tags,
          deprecated: route.deprecated === true,
          security: route.auth === "public" ? [] : [{ bearerAuth: [] }],
          responses: { "200": { description: "成功" } },
        };
        paths[path] = entry;
      }
      return {
        format,
        content: {
          openapi: "3.1.0",
          info: { title: "Saydian赛电 API", version: String(release?.version ?? "draft") },
          paths,
          components: {
            securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
          },
        },
      };
    }
    if (format !== "markdown") throw new BadRequestException("仅支持Markdown或OpenAPI导出");
    const lines = ["# Saydian赛电 API", "", `版本：${release?.version ?? "未发布草稿"}`, ""];
    for (const route of items) {
      lines.push(
        `## ${String(route.method ?? "")} ${String(route.path ?? "")}`,
        "",
        String(route.title ?? route.summary ?? ""),
        "",
        `鉴权：${String(route.auth ?? "public")}`,
        "",
      );
    }
    return { format, content: lines.join("\n") };
  }
}

function findRoute(routeKey: string): CatalogRoute {
  const route = apiCatalog.routes.find((item) => item.key === routeKey);
  if (!route) throw new NotFoundException("接口路由不存在");
  return route;
}

function routeSignature(route: CatalogRoute): string {
  return sha256(
    JSON.stringify({
      method: route.method,
      path: route.path,
      auth: route.auth,
      roles: route.roles,
      parameters: route.parameters,
      envelope: route.envelope,
    }),
  );
}

function currentRouteDigest(): string {
  return sha256(apiCatalog.routes.map(routeSignature).join("|"));
}

function sanitizeInputJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return sanitizeExample(value) as Prisma.InputJsonValue;
}

function sanitizeExample(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeExample);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/token|password|secret|authorization|mobile|phone|ip(address)?/i.test(key)) {
        output[key] = "***";
      } else {
        output[key] = sanitizeExample(item);
      }
    }
    return output;
  }
  if (typeof value === "string") {
    return value
      .replace(/1\d{10}/g, "138****0000")
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "***.***.***.***");
  }
  return value;
}

function cleanText(value: unknown, maximum: number) {
  return String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, maximum);
}
