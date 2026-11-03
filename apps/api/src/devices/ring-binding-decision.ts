import { BadRequestException, ConflictException } from "@nestjs/common";
import { sha256 } from "../common/crypto";

// 这是业务决定回执，不是可按 TTL 丢弃后重算的普通请求缓存。
// 即使 expiresAt 已过，也必须读取原决定；清空授权永远不能重放。
export const RING_BINDING_DECISION_SCOPE = "say-ring:first-binding:v1";
export const RING_BINDING_DECISION_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

export function ringInitializationOperationId(value: unknown): string {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new BadRequestException("请提供有效的设备初始化操作标识");
  }
  return value;
}

export function ringDecisionRequestHash(userId: string, deviceId: string, operationId: string) {
  return sha256(JSON.stringify({ schemaVersion: 1, userId, product: "say-ring", deviceId, operationId }));
}

export type RingBindingDecision = {
  schemaVersion: 1;
  ownerId: string;
  hardwareKey: string;
  product: "say-ring";
  deviceId: string;
  operationId: string;
  decision: "preserve" | "clear-issued";
};

export function ringDecisionConflict(errorKey = "RING_INITIALIZATION_DECISION_UNCONFIRMED"): never {
  throw new ConflictException({ message: "设备初始化记录暂时无法确认", errorKey });
}

export function readRingBindingDecision(
  record: { requestHash: string; responseCode: number; responseBody: unknown },
  userId: string,
  deviceId: string,
  operationId: string,
): RingBindingDecision {
  if (record.requestHash !== ringDecisionRequestHash(userId, deviceId, operationId)) {
    ringDecisionConflict("RING_INITIALIZATION_OPERATION_CONFLICT");
  }
  const raw = record.responseBody;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) ringDecisionConflict();
  const value = raw as Record<string, unknown>;
  if (record.responseCode !== 200 || value.schemaVersion !== 1 ||
      value.ownerId !== userId || value.hardwareKey !== sha256(`${userId}:${deviceId}`) ||
      value.product !== "say-ring" || value.deviceId !== deviceId ||
      value.operationId !== operationId ||
      (value.decision !== "preserve" && value.decision !== "clear-issued") ||
      Object.keys(value).sort().join(",") !==
        "decision,deviceId,hardwareKey,operationId,ownerId,product,schemaVersion") {
    ringDecisionConflict();
  }
  return value as RingBindingDecision;
}
