import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";
import {
  RING_BINDING_DECISION_EXPIRY,
  RING_BINDING_DECISION_SCOPE,
  readRingBindingDecision,
  ringDecisionConflict,
  ringDecisionRequestHash,
  ringInitializationOperationId,
  type RingBindingDecision,
} from "./ring-binding-decision";

function normalizedMacAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^[0-9a-f]{12}$/i.test(raw) && !/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(raw)) {
    throw new BadRequestException("MAC 地址格式不正确");
  }
  const compact = raw.replace(/[:-]/g, "");
  const normalized = compact.match(/.{2}/g)?.join(":").toUpperCase() ?? "";
  if (!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalized)) {
    throw new BadRequestException("MAC 地址格式不正确");
  }
  return normalized;
}

function escapedRawPayloadPart(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function serializedRawPayload(body: Record<string, unknown>): string {
  const rawPayload = Object.entries(body)
    .map(([key, value]) => {
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      return `${escapedRawPayloadPart(key)}=${escapedRawPayloadPart(rendered ?? "")}`;
    })
    .join(" | ");
  if (Buffer.byteLength(rawPayload, "utf8") > 65_535) {
    throw new BadRequestException("设备上报原始数据过大");
  }
  return rawPayload;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 只读确认：此会员在这枚戒指首次入库前是否已有其他终生绑定。
   * 不能重放首次清空授权，也不靠最近连接、名字推断。
   * 目标缺失时只确认已有终生绑定的会员；目标存在则要求更早历史。
   */
  async bindingHistoryStatus(userId: string, product: string, deviceId: string) {
    const sourceId = String(deviceId ?? "").trim();
    if (product !== "say-ring" || !sourceId || sourceId.length > 512) {
      throw new BadRequestException("请提供明确的 Say Ring 设备标识");
    }
    const hardwareKey = sha256(`${userId}:${sourceId}`);
    return this.prisma.$transaction(async (tx) => {
      // 与绑定事务使用同一会员行锁。不能先读不到目标，再把并发首绑产生的
      // 其他记录当作旧历史；整个证明必须来自同一受保护的状态。
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const target = await tx.deviceBinding.findFirst({
        where: { userId, hardwareKey },
        select: { id: true, createdAt: true },
      });
      if (!target) {
        // 清空决定与目标入库在同一事务提交，解绑也只软标记。因此精确目标
        // 不存在且会员已有其他终生绑定，证明此目标未曾提交清空授权。
        const prior = await tx.deviceBinding.findFirst({ where: { userId }, select: { id: true } });
        return { product: "say-ring", deviceId: sourceId, priorBindingConfirmed: !!prior };
      }
      // PostgreSQL 的事务时间可能早于等待会员行锁的时间。
      // 只接受早于目标 30 秒的既有记录，覆盖下面显式限制的 2 秒排队+
      // 5 秒事务窗口，避免并发首绑的写入顺序与时间顺序不同而误确认。
      const before = target.createdAt instanceof Date
        ? new Date(target.createdAt.getTime() - 30_000)
        : undefined;
      const earlier = before instanceof Date && Number.isFinite(before.getTime())
        ? await tx.deviceBinding.findFirst({
          where: {
            userId,
            id: { not: target.id },
            createdAt: { lt: before },
          },
          select: { id: true },
        })
        : null;
      // 不过滤 unboundAt：解绑不应让老会员重新获得清空戒指的资格。
      return { product: "say-ring", deviceId: sourceId, priorBindingConfirmed: !!earlier };
    }, { maxWait: 2_000, timeout: 5_000 });
  }

  async bind(userId: string, input: unknown) {
    if (safeObject(input).initializationOperationId !== undefined) {
      throw new BadRequestException("请使用带操作标识的首次绑定接口");
    }
    return this.bindWithDecision(userId, input);
  }

  async firstBindingDecision(userId: string, input: unknown) {
    const body = safeObject(input);
    if (body.product !== "say-ring" || body.initializeFirstBinding !== true) {
      throw new BadRequestException("请提供明确的 Say Ring 首次绑定请求");
    }
    const operationId = ringInitializationOperationId(body.initializationOperationId);
    return this.bindWithDecision(userId, input, operationId);
  }

  async bindingInitializationStatus(userId: string, product: string, deviceId: string, operation: string) {
    const sourceId = String(deviceId ?? "").trim();
    if (product !== "say-ring" || !sourceId || sourceId.length > 512) {
      throw new BadRequestException("请提供明确的 Say Ring 设备标识");
    }
    const operationId = ringInitializationOperationId(operation);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_scope_key: { userId, scope: RING_BINDING_DECISION_SCOPE, key: operationId } },
    });
    const decision = existing
      ? readRingBindingDecision(existing, userId, sourceId, operationId).decision
      : "not-found";
    // GET 从不返回 shouldClear=true；明确 preserve 才可恢复历史同步。
    return { product: "say-ring", deviceId: sourceId, operationId, decision };
  }

  private async bindWithDecision(userId: string, input: unknown, operationId?: string) {
    const body = safeObject(input);
    const sourceId = String(body.deviceId ?? body.hardwareId ?? "").trim();
    const vendor = String(body.vendor ?? "").trim();
    const model = String(body.model ?? "").trim();
    const displayName = String(body.displayName ?? body.name ?? model).trim();
    const macAddress = normalizedMacAddress(body.macAddress);
    if (!sourceId || (operationId && sourceId.length > 512) || !vendor || !model || !displayName) {
      throw new BadRequestException("设备信息不完整");
    }
    const capabilities = Array.isArray(body.capabilities)
      ? [...new Set(body.capabilities.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    if (capabilities.length > 200) throw new BadRequestException("设备能力数量异常");
    const hardwareKey = sha256(`${userId}:${sourceId}`);
    const firmware = body.firmware ? String(body.firmware).trim() : null;
    const syncCursor = body.syncCursor ? String(body.syncCursor).trim() : null;
    const rawPayload = serializedRawPayload(body);
    const initializeFirstBinding = body.product === "say-ring" &&
      body.initializeFirstBinding === true;
    const connectedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize ALL reports, including old clients, for this member. Count
      // lifetime bindings, not just currently bound devices. A lost response
      // deliberately cannot issue a second destructive initialization grant.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (operationId) {
        const previous = await tx.idempotencyRecord.findUnique({
          where: { userId_scope_key: { userId, scope: RING_BINDING_DECISION_SCOPE, key: operationId } },
        });
        if (previous) {
          const decision = readRingBindingDecision(previous, userId, sourceId, operationId);
          if (decision.decision === "clear-issued") {
            ringDecisionConflict("RING_INITIALIZATION_ALREADY_ISSUED");
          }
          const binding = await tx.deviceBinding.findFirst({ where: { userId, hardwareKey } });
          if (!binding) ringDecisionConflict();
          // 重试只读原决定，不重复连接事件，不把当前 count>0 当作原决定。
          return { binding, firstBinding: false };
        }
      }
      const firstBinding = initializeFirstBinding &&
        await tx.deviceBinding.count({ where: { userId } }) === 0;
      const binding = await tx.deviceBinding.upsert({
        where: { hardwareKey },
        create: {
          userId,
          hardwareKey,
          vendor,
          model,
          displayName,
          macAddress,
          firmware,
          capabilities: capabilities as Prisma.InputJsonValue,
          syncCursor,
          lastSeenAt: connectedAt,
        },
        update: {
          userId,
          vendor,
          model,
          displayName,
          ...(macAddress ? { macAddress } : {}),
          ...(firmware ? { firmware } : {}),
          capabilities: capabilities as Prisma.InputJsonValue,
          syncCursor,
          unboundAt: null,
          lastSeenAt: connectedAt,
        },
      });
      await tx.deviceConnectionEvent.create({
        data: {
          deviceBindingId: binding.id,
          connectedAt,
          vendor,
          model,
          displayName,
          macAddress,
          firmware,
          rawPayload,
        },
      });
      if (operationId) {
        const receipt: RingBindingDecision = {
          schemaVersion: 1, ownerId: userId, hardwareKey,
          product: "say-ring", deviceId: sourceId, operationId,
          decision: firstBinding ? "clear-issued" : "preserve",
        };
        // 与绑定、连接事件同事务写入；网络响应丢失后可按原操作追溯。
        // 本 scope 终生保留，只有账号注销才随会员数据删除；不得做 TTL 重算。
        await tx.idempotencyRecord.create({ data: {
          userId, scope: RING_BINDING_DECISION_SCOPE, key: operationId,
          requestHash: ringDecisionRequestHash(userId, sourceId, operationId),
          responseCode: 200, responseBody: receipt,
          expiresAt: RING_BINDING_DECISION_EXPIRY,
        } });
      }
      return { binding, firstBinding };
    }, { maxWait: 2_000, timeout: 5_000 });
    return {
      ...this.contract(result.binding),
      ...(initializeFirstBinding ? {
        firstBindingInitialization: {
          product: "say-ring", deviceId: sourceId,
          ...(operationId ? { operationId } : {}),
          shouldClear: result.firstBinding,
        },
      } : {}),
    };
  }

  async list(userId: string) {
    const devices = await this.prisma.deviceBinding.findMany({
      where: { userId, unboundAt: null },
      orderBy: { lastSeenAt: "desc" },
    });
    return devices.map((item) => this.contract(item));
  }

  async updateCapabilities(userId: string, id: string, input: unknown) {
    const body = safeObject(input);
    const capabilities = Array.isArray(body.capabilities)
      ? [...new Set(body.capabilities.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    const device = await this.prisma.deviceBinding.findFirst({ where: { id, userId } });
    if (!device || device.unboundAt) throw new NotFoundException("未找到已连接的设备");
    return this.contract(
      await this.prisma.deviceBinding.update({
        where: { id },
        data: {
          capabilities: capabilities as Prisma.InputJsonValue,
          firmware: body.firmware ? String(body.firmware) : device.firmware,
          syncCursor: body.syncCursor ? String(body.syncCursor) : device.syncCursor,
          lastSeenAt: new Date(),
        },
      }),
    );
  }

  async unbind(userId: string, id: string) {
    const result = await this.prisma.deviceBinding.updateMany({
      where: { id, userId, unboundAt: null },
      data: { unboundAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("未找到已连接的设备");
    return { unbound: true };
  }

  private contract(device: {
    id: string;
    hardwareKey: string;
    vendor: string;
    model: string;
    displayName: string;
    macAddress: string | null;
    firmware: string | null;
    capabilities: Prisma.JsonValue;
    syncCursor: string | null;
    lastSeenAt: Date | null;
  }) {
    return {
      id: device.id,
      hardwareKey: device.hardwareKey,
      vendor: device.vendor,
      model: device.model,
      displayName: device.displayName,
      macAddress: device.macAddress,
      firmware: device.firmware,
      capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
      syncCursor: device.syncCursor,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    };
  }
}
