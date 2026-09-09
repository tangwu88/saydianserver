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
import { documentedExample, generateOpenApi } from "./openapi";

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
        const defaults = documentationDefaults(route);
        return {
          routeKey: route.key,
          method: route.method,
          path: route.path,
          auth: route.auth,
          roles: route.roles,
          parameters: route.parameters,
          envelope: route.envelope,
          successStatus: route.successStatus,
          contract: route.contract,
          source: route.source,
          request: route.request,
          response: route.response,
          dependency: route.dependency,
          title: annotation?.title || route.summary,
          summary: annotation?.summary || defaultSummary(route),
          businessExample: hasDocumentedValue(annotation?.businessExample)
            ? sanitizeExample(annotation?.businessExample) : defaults.businessExample,
          errorGuidance: sanitizeExample(
            hasDocumentedValue(annotation?.errorGuidance)
              ? annotation?.errorGuidance
              : defaults.errorGuidance,
          ),
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
      return {
        format,
        content: generateOpenApi(items, String(release?.version ?? "draft")),
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
        "请求说明：",
        "",
        String(route.request ?? "无请求体"),
        "",
        "预期返回：",
        "",
        String(route.response ?? ""),
        "",
        "调用示例：",
        "",
        "```json",
        JSON.stringify(route.businessExample ?? {}, null, 2),
        "```",
        "",
        "错误处理：",
        "",
        "```json",
        JSON.stringify(route.errorGuidance ?? {}, null, 2),
        "```",
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
      successStatus: route.successStatus,
      contract: route.contract,
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

function sanitizeExample(value: unknown, schema = false, sensitiveSchema = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeExample(item, schema, sensitiveSchema));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const sensitive = /^(?:.*(?:token|password|secret)|authorization|mobile|phone|ip|ipAddress)$/i.test(key);
      const schemaNode = schema || /^(?:请求Schema|返回Schema|requestSchema|responseSchema|schema|\$defs|definitions)$/.test(key)
        || (sensitive && isSchemaObject(item));
      if ((sensitive && !schemaNode) || (schema && sensitiveSchema && /^(?:default|example|examples|const|enum)$/.test(key))) {
        output[key] = sanitizeSensitiveValue(item);
      } else {
        output[key] = sanitizeExample(item, schemaNode, sensitive || (sensitiveSchema && key !== "properties"));
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

function isSchemaObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  return (typeof node.type === "string" && ["string", "object", "array", "integer", "number", "boolean", "null"].includes(node.type))
    || typeof node.$ref === "string" || ["properties", "allOf", "anyOf", "oneOf"].some((key) => key in node);
}

function sanitizeSensitiveValue(value: unknown): unknown {
  if (typeof value === "string" && /^(?:Bearer\s+)?<[A-Z][A-Z0-9_]*>$/.test(value.trim())) return value;
  if (Array.isArray(value)) return value.map(sanitizeSensitiveValue);
  return "***";
}

function cleanText(value: unknown, maximum: number) {
  return String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, maximum);
}

function documentationDefaults(route: CatalogRoute) {
  const tokenName = route.auth === "admin" ? "后台Token" : route.auth === "member" ? "会员Token" : "访问Token";
  const requestNeedsBody = ["POST", "PUT", "PATCH"].includes(route.method) && route.request !== "无请求体";
  const errors: Record<string, string> = {
    "400": "请求格式、必填字段或业务校验未通过；按“请求说明”修正后再提交。",
  };
  if (route.auth !== "public") errors["401"] = `${tokenName}缺失、无效或已失效；重新获取会话后重试。`;
  if (route.roles.length) errors["403"] = `当前后台角色不具备权限；需要角色：${route.roles.join("、")}。`;
  if (route.path.includes(":")) errors["404"] = "路径中的资源标识不存在，或当前账号无权读取该资源。";
  errors["409"] = "版本或业务状态已变化、幂等键被不同请求占用；刷新状态后人工确认，不盲目重发支付退款。";
  errors["503"] = "依赖未配置、维护暂停或渠道结果未知；检查集成状态和对账记录，不能把未知结果当作失败重新出款。";
  if (route.key.startsWith("Legacy")) errors["HTTP状态"] = "旧接口业务错误以HTTP 200包裹，必须检查响应code和message。";
  errors["处理原则"] = requestNeedsBody && /Idempotency-Key/i.test(route.request)
    ? "网络重试必须复用同一个幂等键；新业务操作使用新的幂等键。"
    : "读取接口可在短暂网络错误后重试；写接口仅在接口约定支持幂等时重试。";

  return {
    businessExample: documentedExample(route),
    errorGuidance: errors,
  };
}

function defaultSummary(route: CatalogRoute): string {
  const request = route.request === "无请求体" ? "无需请求体" : `请求：${route.request}`;
  const dependency = route.dependency === "核心服务" ? "" : `；依赖：${route.dependency}`;
  return `${route.summary}。${request}；成功返回：${route.response}${dependency}。`;
}

function hasDocumentedValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== "object" || Object.keys(value as Record<string, unknown>).length > 0;
}
