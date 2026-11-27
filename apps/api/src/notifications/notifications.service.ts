import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { isUuid, safeObject } from "../common/crypto";

import { globalLocale } from "../auth/global-identity";

function productNotifications(product?: string): Prisma.NotificationWhereInput {
  return product === "saydian-app-cn"
    ? { NOT: { OR: ["ring-share:", "ring-care:", "ring-joined:"].map((prefix) => ({ eventId: { startsWith: prefix } })) } }
    : { NOT: { eventId: { startsWith: "cn-ring-" } } };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async preferences(userId: string) {
    const preference = await this.prisma.userNotificationPreference.findUnique({
      where: { userId },
    });
    return {
      transactionalEnabled: preference?.transactionalEnabled ?? true,
      marketingEnabled: preference?.marketingEnabled ?? false,
      updatedAt: preference?.updatedAt.toISOString() ?? null,
    };
  }

  async updatePreferences(userId: string, input: unknown) {
    const body = safeObject(input);
    if (
      body.transactionalEnabled !== undefined &&
      typeof body.transactionalEnabled !== "boolean"
    ) {
      throw new BadRequestException("事务通知设置不正确");
    }
    if (
      body.marketingEnabled !== undefined &&
      typeof body.marketingEnabled !== "boolean"
    ) {
      throw new BadRequestException("营销通知设置不正确");
    }
    if (
      body.transactionalEnabled === undefined &&
      body.marketingEnabled === undefined
    ) {
      throw new BadRequestException("请至少选择一项通知设置");
    }
    const preference = await this.prisma.userNotificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        transactionalEnabled: body.transactionalEnabled !== false,
        marketingEnabled: body.marketingEnabled === true,
      },
      update: {
        ...(body.transactionalEnabled !== undefined
          ? { transactionalEnabled: body.transactionalEnabled }
          : {}),
        ...(body.marketingEnabled !== undefined
          ? { marketingEnabled: body.marketingEnabled }
          : {}),
      },
    });
    return {
      transactionalEnabled: preference.transactionalEnabled,
      marketingEnabled: preference.marketingEnabled,
      updatedAt: preference.updatedAt.toISOString(),
    };
  }

  async registerInstallation(userId: string, input: unknown) {
    const body = safeObject(input);
    const installationId = String(
      body.installationId ?? body.installation_id ?? "",
    ).trim();
    const registrationId = String(
      body.registrationId ?? body.registration_id ?? "",
    ).trim();
    const platform = String(body.platform ?? "").toLowerCase();
    const requestedProvider = String(body.provider ?? "jpush").toLowerCase();
    const product = String(body.product ?? "")
      .trim()
      .toLowerCase();
    if (
      !installationId ||
      !registrationId ||
      !["android", "ios", "harmony"].includes(platform)
    ) {
      throw new BadRequestException("通知设备信息不完整");
    }
    if (!new Set(["jpush", "apns", "disabled"]).has(requestedProvider)) {
      throw new BadRequestException("通知服务类型不正确");
    }
    if (product && !["say-ring", "saydian-app-cn"].includes(product)) {
      throw new BadRequestException("通知产品标识不正确");
    }
    const provider =
      product === "saydian-app-cn" && requestedProvider === "jpush"
        ? "jpush_saydian_cn"
        : product === "say-ring" && requestedProvider === "jpush"
        ? "jpush_say_ring"
        : requestedProvider;
    const installation = await this.prisma.pushInstallation.upsert({
      where: { installationId },
      create: {
        userId,
        installationId,
        registrationId,
        platform,
        provider,
        appVersion: String(body.appVersion ?? body.app_version ?? "unknown"),
        buildNumber: String(
          body.buildNumber ?? body.build_number ?? body.build ?? "unknown",
        ),
        locale: globalLocale(body.locale),
      },
      update: {
        userId,
        registrationId,
        platform,
        provider,
        appVersion: String(body.appVersion ?? body.app_version ?? "unknown"),
        buildNumber: String(
          body.buildNumber ?? body.build_number ?? body.build ?? "unknown",
        ),
        locale: globalLocale(body.locale),
        enabled: true,
        lastSeenAt: new Date(),
      },
    });
    return {
      installationId: installation.installationId,
      registered: true,
    };
  }

  async unregisterInstallation(userId: string, installationId: string) {
    const result = await this.prisma.pushInstallation.updateMany({
      where: { userId, installationId },
      data: { enabled: false, registrationId: "revoked" },
    });
    return { unregistered: result.count > 0 };
  }

  async list(userId: string, pageInput = 1, pageSizeInput = 30, product?: string) {
    if (
      !Number.isSafeInteger(Number(pageInput)) ||
      Number(pageInput) < 1 ||
      !Number.isSafeInteger(Number(pageSizeInput)) ||
      Number(pageSizeInput) < 1
    ) {
      throw new BadRequestException("分页参数必须为正整数");
    }
    const page = Number(pageInput);
    const pageSize = Math.min(Number(pageSizeInput), 100);
    if (!Number.isSafeInteger((page - 1) * pageSize)) {
      throw new BadRequestException("分页参数超出范围");
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId, ...productNotifications(product) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where: { userId, ...productNotifications(product) } }),
    ]);
    return {
      items: items.map((item) => this.contract(item)),
      page,
      pageSize,
      total,
    };
  }

  async detail(userId: string, id: string, product?: string) {
    const item = await this.prisma.notification.findFirst({
      where: { id, userId, ...productNotifications(product) },
    });
    if (!item) throw new NotFoundException("消息不存在");
    return this.contract(item);
  }

  async unreadCount(userId: string, product?: string) {
    return {
      count: await this.prisma.notification.count({
        where: { userId, readAt: null, ...productNotifications(product) },
      }),
    };
  }

  async markRead(userId: string, identifier: string, product?: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        ...productNotifications(product),
        OR: [
          ...(isUuid(identifier) ? [{ id: identifier }] : []),
          { eventId: identifier },
        ],
      },
      data: { readAt: new Date() },
    });
    return { read: result.count > 0 };
  }

  async createSystemNotification(
    userId: string,
    eventId: string,
    title: string,
    body: string,
    deepLink?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.prisma.notification.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: {
        userId,
        eventId,
        type: "SYSTEM",
        title,
        body,
        deepLink: deepLink ?? null,
        metadata: metadata ?? Prisma.JsonNull,
      },
      update: {
        title,
        body,
        deepLink: deepLink ?? null,
        metadata: metadata ?? Prisma.JsonNull,
        readAt: null,
      },
    });
  }

  private contract(item: {
    id: string;
    eventId: string;
    type: string;
    title: string;
    body: string;
    deepLink: string | null;
    metadata: Prisma.JsonValue | null;
    readAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: item.id,
      eventId: item.eventId,
      type: item.type.toLowerCase(),
      title: item.title,
      body: item.body,
      deepLink: item.deepLink,
      metadata: item.metadata,
      createdAt: item.createdAt.toISOString(),
      readAt: item.readAt?.toISOString() ?? null,
    };
  }
}
