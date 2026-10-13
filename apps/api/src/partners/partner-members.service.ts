import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { isUuid } from "../common/crypto";
import {
  adminDeviceIdentifier,
  legacyNativeDeviceKey,
} from "../common/device-identity";
import { partnerPage } from "./partner-commerce.service";
import { foldedHealthRecordWhere } from "../health/health-record-scope";
import { SupportService } from "../support/support.service";

const deviceSelect = {
  id: true,
  hardwareKey: true,
  vendor: true,
  model: true,
  displayName: true,
  macAddress: true,
  firmware: true,
  capabilities: true,
  boundAt: true,
  unboundAt: true,
  lastSeenAt: true,
} satisfies Prisma.DeviceBindingSelect;
const healthSelect = {
  id: true,
  clientRecordId: true,
  metric: true,
  observedAt: true,
  timezoneOffsetMinutes: true,
  values: true,
  unit: true,
  quality: true,
  sourcePlatform: true,
  sourceModel: true,
  sourceFirmware: true,
  sourceOrigin: true,
  sourceMeasurementSource: true,
  sourceRawVersion: true,
  ecgArtifact: {
    select: { sampleRateHz: true, sampleCount: true, sha256: true },
  },
} satisfies Prisma.HealthRecordSelect;

@Injectable()
export class PartnerMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
  ) {}

  private async requireMember(
    tx: Prisma.TransactionClient,
    partnerId: string,
    id: string,
  ) {
    if (!isUuid(id)) throw new NotFoundException("会员不存在");
    // Every query below also includes the relation scope, including paged child resources.
    const member = await tx.user.findFirst({
      where: { id, partnerId, status: { not: "DELETED" } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException("会员不存在");
  }

  private audit(
    tx: Prisma.TransactionClient,
    partnerId: string,
    entityId: string,
    resource: string,
    requestId: string,
    count: number,
    page?: number,
  ) {
    return tx.auditLog.create({
      data: {
        actorType: "PARTNER",
        actorId: partnerId,
        action: "PARTNER_MEMBER_READ",
        entityType: resource,
        entityId,
        requestId,
        afterJson: {
          reason: "所属品牌伙伴会员服务",
          resource,
          returnedCount: count,
          ...(page ? { page } : {}),
        },
      },
    });
  }

  async members(partnerId: string, search: string, pageInput: unknown) {
    const { page, pageSize, skip } = partnerPage(pageInput);
    const where: Prisma.UserWhereInput = {
      partnerId,
      status: { not: "DELETED" },
      ...(search
        ? {
            OR: [
              { nickname: { contains: search.trim(), mode: "insensitive" } },
              { mobile: { contains: search.trim() } },
              { email: { contains: search.trim(), mode: "insensitive" } },
              ...(/^[1-9]\d{0,8}$/.test(search.trim())
                ? [{ compatibilityId: Number(search.trim()) }]
                : []),
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          compatibilityId: true,
          nickname: true,
          mobile: true,
          email: true,
          avatarUrl: true,
          gender: true,
          createdAt: true,
          _count: { select: { devices: true, healthRecords: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        memberNo: String(item.compatibilityId),
      })),
      total,
      page,
      pageSize,
    };
  }

  profile(partnerId: string, id: string, requestId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.requireMember(tx, partnerId, id);
        const member = await tx.user.findFirstOrThrow({
          where: { id, partnerId },
          select: {
            id: true,
            compatibilityId: true,
            nickname: true,
            mobile: true,
            email: true,
            avatarUrl: true,
            gender: true,
            birthday: true,
            heightCm: true,
            weightKg: true,
            status: true,
            createdAt: true,
            healthProfile: true,
          },
        });
        await this.audit(tx, partnerId, id, "USER_PROFILE", requestId, 1);
        return { ...member, memberNo: String(member.compatibilityId) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  healthSummary(partnerId: string, id: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, partnerId, id);
      const rows = await tx.healthRecord.groupBy({
        by: ["metric"],
        where: {
          userId: id,
          user: { partnerId },
          AND: [foldedHealthRecordWhere()],
        },
        _count: { _all: true },
        _min: { observedAt: true },
        _max: { observedAt: true },
      });
      await this.audit(
        tx,
        partnerId,
        id,
        "HEALTH_SUMMARY",
        requestId,
        rows.length,
      );
      return {
        items: rows.map((row) => ({
          metric: row.metric.toLowerCase(),
          count: row._count._all,
          firstObservedAt: row._min.observedAt,
          lastObservedAt: row._max.observedAt,
        })),
      };
    });
  }

  healthRecords(
    partnerId: string,
    id: string,
    requestId: string,
    pageInput: unknown,
    pageSizeInput: unknown,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, partnerId, id);
      const { page, pageSize, skip } = partnerPage(pageInput, pageSizeInput);
      const where = { userId: id, user: { partnerId } };
      const total = await tx.healthRecord.count({ where });
      const items = await tx.healthRecord.findMany({
        where,
        select: healthSelect,
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      });
      await this.audit(
        tx,
        partnerId,
        id,
        "HEALTH_RECORD",
        requestId,
        items.length,
        page,
      );
      return {
        items: items.map((row) => ({
          ...row,
          metric: row.metric.toLowerCase(),
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  devices(partnerId: string, userId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, partnerId, userId);
      const items = await tx.deviceBinding.findMany({
        where: { userId, user: { partnerId } },
        select: deviceSelect,
        orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      });
      await this.audit(
        tx,
        partnerId,
        userId,
        "DEVICE",
        requestId,
        items.length,
      );
      return {
        items: items.map(({ hardwareKey, ...row }) => ({
          ...row,
          deviceIdentifier: adminDeviceIdentifier(hardwareKey),
        })),
      };
    });
  }

  private async requireDevice(
    tx: Prisma.TransactionClient,
    partnerId: string,
    id: string,
  ) {
    if (!isUuid(id)) throw new NotFoundException("设备不存在");
    const device = await tx.deviceBinding.findFirst({
      where: { id, user: { partnerId, status: { not: "DELETED" } } },
      select: {
        ...deviceSelect,
        userId: true,
        connectionEvents: {
          take: 1,
          orderBy: { connectedAt: "desc" },
          select: { rawPayload: true },
        },
      },
    });
    if (!device) throw new NotFoundException("设备不存在");
    return device;
  }

  connections(
    partnerId: string,
    id: string,
    requestId: string,
    pageInput: unknown,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireDevice(tx, partnerId, id);
      const { page, pageSize, skip } = partnerPage(pageInput);
      const where = {
        deviceBindingId: id,
        deviceBinding: { user: { partnerId } },
      };
      const total = await tx.deviceConnectionEvent.count({ where });
      const items = await tx.deviceConnectionEvent.findMany({
        where,
        select: {
          id: true,
          connectedAt: true,
          vendor: true,
          model: true,
          displayName: true,
          macAddress: true,
          firmware: true,
        },
        orderBy: [{ connectedAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      });
      await this.audit(
        tx,
        partnerId,
        id,
        "DEVICE_CONNECTION",
        requestId,
        items.length,
        page,
      );
      return { items, total, page, pageSize };
    });
  }

  measurements(
    partnerId: string,
    id: string,
    requestId: string,
    pageInput: unknown,
    pageSizeInput: unknown,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const device = await this.requireDevice(tx, partnerId, id),
        { page, pageSize, skip } = partnerPage(pageInput, pageSizeInput);
      const alias = legacyNativeDeviceKey(
        device.userId,
        device.hardwareKey,
        device.connectionEvents[0]?.rawPayload ?? "",
      );
      const where = {
        userId: device.userId,
        user: { partnerId },
        OR: [
          { deviceBindingId: id },
          { sourceDeviceKey: device.hardwareKey },
          ...(alias ? [{ sourceDeviceKey: alias }] : []),
        ],
      };
      const total = await tx.healthRecord.count({ where });
      const items = await tx.healthRecord.findMany({
        where,
        select: healthSelect,
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      });
      await this.audit(
        tx,
        partnerId,
        id,
        "DEVICE_MEASUREMENT",
        requestId,
        items.length,
        page,
      );
      return {
        items: items.map((row) => ({
          ...row,
          metric: row.metric.toLowerCase(),
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  async ecg(partnerId: string, id: string, requestId: string) {
    if (!isUuid(id)) throw new NotFoundException("心电波形不存在");
    const record = await this.prisma.$transaction(async (tx) => {
      const row = await tx.healthRecord.findFirst({
        where: {
          id,
          user: { partnerId, status: { not: "DELETED" } },
          metric: "ECG",
          ecgArtifact: { isNot: null },
        },
        select: { userId: true, clientRecordId: true },
      });
      if (!row) throw new NotFoundException("心电波形不存在");
      await this.audit(tx, partnerId, id, "ECG_ARTIFACT", requestId, 1);
      return row;
    });
    return this.support.privateEcgArtifact(
      record.userId,
      record.clientRecordId,
    );
  }

  reports(
    partnerId: string,
    userId: string,
    requestId: string,
    pageInput: unknown,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, partnerId, userId);
      const { page, pageSize, skip } = partnerPage(pageInput),
        where = { userId, user: { partnerId } };
      const items = await tx.healthReport.findMany({
        where,
        select: {
          id: true,
          status: true,
          windowStart: true,
          windowEnd: true,
          distinctDays: true,
          validRecordCount: true,
          generatedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      });
      const total = await tx.healthReport.count({ where });
      await this.audit(
        tx,
        partnerId,
        userId,
        "HEALTH_REPORT_LIST",
        requestId,
        items.length,
        page,
      );
      return { items, total, page, pageSize };
    });
  }

  report(partnerId: string, id: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      if (!isUuid(id)) throw new NotFoundException("健康报告不存在");
      const report = await tx.healthReport.findFirst({
        where: { id, user: { partnerId, status: { not: "DELETED" } } },
        select: {
          id: true,
          status: true,
          windowStart: true,
          windowEnd: true,
          generatedAt: true,
          metricSummary: true,
          freePreview: true,
          fullContent: true,
        },
      });
      if (!report) throw new NotFoundException("健康报告不存在");
      await this.audit(tx, partnerId, id, "HEALTH_REPORT", requestId, 1);
      return {
        ...report,
        fullContent: report.status === "READY" ? report.fullContent : null,
      };
    });
  }
}
