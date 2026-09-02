import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { env, envBoolean } from "../common/environment";
import { safeObject } from "../common/crypto";

@Injectable()
export class CommerceService {
  private readonly baseUrl = env(
    "MALL_BASE_URL",
    "https://stest.saydian.cn/api/saidian-mall/v1",
  ).replace(/\/$/, "");

  constructor(private readonly prisma: PrismaService) {}

  publicGet(path: string) {
    return this.request("GET", path);
  }

  async forUser(
    userId: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ) {
    const mallUserId = await this.ensureMallIdentity(userId);
    return this.request(method, `/internal/app-users/${mallUserId}${path}`, body, {
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    });
  }

  async orders(userId: string, status?: string) {
    const [current, legacy] = await Promise.all([
      this.forUser(
        userId,
        "GET",
        `/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      ).catch((error: unknown) => {
        if (error instanceof ServiceUnavailableException) return [];
        throw error;
      }),
      this.prisma.legacyOrderProjection.findMany({
        where: { userId, ...(status ? { status } : {}) },
        orderBy: { legacyCreatedAt: "desc" },
      }),
    ]);
    const currentItems = Array.isArray(current)
      ? current
      : Array.isArray(safeObject(current).items)
        ? (safeObject(current).items as unknown[])
        : [];
    const combined: Array<Record<string, unknown>> = [
      ...currentItems.map((item) => ({ ...safeObject(item), readOnly: false, source: "mall" })),
      ...legacy.map((item) => ({
        id: item.id,
        legacyOrderId: item.legacyOrderId,
        orderNo: item.orderNo,
        status: item.status,
        payableCents: item.payableCents,
        currency: item.currency,
        createdAt: item.legacyCreatedAt.toISOString(),
        snapshot: item.snapshot,
        readOnly: true,
        source: "legacy",
      })),
    ];
    return combined.sort((a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
    );
  }

  async orderDetail(userId: string, id: string) {
    const legacy = await this.prisma.legacyOrderProjection.findFirst({
      where: { userId, OR: [{ id }, { legacyOrderId: id }] },
    });
    if (legacy) {
      return {
        ...safeObject(legacy.snapshot),
        id: legacy.id,
        legacyOrderId: legacy.legacyOrderId,
        orderNo: legacy.orderNo,
        status: legacy.status,
        payableCents: legacy.payableCents,
        createdAt: legacy.legacyCreatedAt.toISOString(),
        readOnly: true,
        source: "legacy",
      };
    }
    return this.forUser(userId, "GET", `/orders/${encodeURIComponent(id)}`);
  }

  private async ensureMallIdentity(userId: string): Promise<string> {
    const existing = await this.prisma.commerceIdentityMap.findUnique({
      where: { userId },
    });
    if (existing) return existing.mallUserId;
    const token = env("MALL_SERVICE_TOKEN", "");
    if (!token) {
      throw new ServiceUnavailableException("商城账号服务暂时无法使用，请稍后再试");
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const result = safeObject(
      await this.request("POST", "/internal/app-users", {
        externalUserId: user.id,
        mobile: user.mobile,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
      }),
    );
    const mallUserId = String(result.id ?? result.userId ?? "");
    if (!mallUserId) throw new BadGatewayException("商城账号关联失败");
    const mapping = await this.prisma.commerceIdentityMap.upsert({
      where: { userId },
      create: { userId, mallUserId, linkedBy: "service_api" },
      update: { mallUserId, linkedBy: "service_api", linkedAt: new Date() },
    });
    return mapping.mallUserId;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    if (envBoolean("MALL_MOCK_MODE")) {
      return { configured: true, mock: true, method, path, body: body ?? null };
    }
    const internal = path.startsWith("/internal/");
    const serviceToken = env("MALL_SERVICE_TOKEN", "");
    if (internal && !serviceToken) {
      throw new ServiceUnavailableException("商城服务暂时无法使用，请稍后再试");
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(internal ? { "x-saydian-service-token": serviceToken } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new ServiceUnavailableException("商城服务暂时无法使用，请稍后再试");
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      if (response.status === 400)
        throw new BadRequestException("商城请求未完成，请检查后重试");
      if (response.status === 404)
        throw new NotFoundException("商城内容不存在或已下架");
      if (response.status === 409)
        throw new ConflictException("商城状态已更新，请刷新后重试");
      if (response.status === 422)
        throw new UnprocessableEntityException("商城信息不完整，请检查后重试");
      if (response.status === 429)
        throw new HttpException("操作过于频繁，请稍后再试", 429);
      if (response.status === 401 || response.status === 403)
        throw new ServiceUnavailableException("商城服务暂时无法使用，请稍后再试");
      if (response.status >= 400 && response.status < 500)
        throw new BadRequestException("商城请求未完成，请检查后重试");
      throw new BadGatewayException("商城服务暂时无法使用，请稍后再试");
    }
    return payload;
  }
}
