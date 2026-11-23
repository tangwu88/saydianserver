import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createPrivateKey, sign } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";
import { cleanText, digest, ringEnabled, ringProduct, ringUuid } from "./ring-contract";

export const ringFirmwareLimit = 8 * 1024 * 1024;

function identityText(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9. _+-]{0,47}$/.test(value)) {
    throw new BadRequestException("固件目标信息不完整");
  }
  return value.trim();
}

function firmwareDevice(input: unknown) {
  const body = safeObject(input);
  const { platform, transport } = body;
  if ((platform !== "ios" && platform !== "android") ||
      (transport !== "qring" && transport !== "coolwear" && transport !== "urion")) {
    throw new BadRequestException("固件通道无效");
  }
  return { platform, transport, model: identityText(body.model),
    hardware: identityText(body.hardware), fromVersion: identityText(body.fromVersion) };
}

function boundedInteger(value: unknown, min: number, max: number) {
  const text = String(value ?? "");
  if (!/^\d{1,10}$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new BadRequestException("固件参数无效");
  }
  return Number(text);
}

type Target = ReturnType<typeof firmwareDevice> & { version: string };

export function firmwareQualified(row: Target,
  approved = process.env.SAY_RING_VERIFIED_FIRMWARE_UPGRADES ?? "") {
  return approved.split(",").includes(
    [row.platform, row.transport, row.model, row.hardware, row.fromVersion, row.version].join(":"),
  );
}

const releaseFields = {
  id: true, platform: true, transport: true, model: true, hardware: true,
  fromVersion: true, version: true, bytes: true, minBuild: true,
  minBattery: true, sha256: true, enabled: true, createdAt: true,
} as const;

@Injectable()
export class RingFirmware {
  constructor(private readonly db: PrismaService) {}

  async lookup(input: unknown) {
    ringEnabled("firmware");
    const target = firmwareDevice(input);
    const appBuild = boundedInteger(safeObject(input).appBuild, 1, 2_147_483_647);
    const rows = await this.db.ringFirmwareRelease.findMany({
      where: { ...target, enabled: true, minBuild: { lte: appBuild } },
      orderBy: { createdAt: "desc" }, select: releaseFields, take: 25,
    });
    const row = rows.find((row) => firmwareQualified(row));
    if (!row) return { available: false };
    const privateKey = this.privateKey();
    const payload = Buffer.from(JSON.stringify({
      product: ringProduct, ...target, id: row.id, version: row.version,
      bytes: row.bytes, sha256: row.sha256, minBuild: row.minBuild,
      minBattery: row.minBattery, expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
    }));
    return {
      available: true,
      payload: payload.toString("base64url"),
      signature: sign(null, payload, privateKey).toString("base64url"),
    };
  }

  async package(id: string) {
    ringEnabled("firmware");
    const row = await this.db.ringFirmwareRelease.findFirst({
      where: { id: ringUuid(id), enabled: true },
      select: { ...releaseFields, package: true },
    });
    if (!row || !firmwareQualified(row) || row.bytes !== row.package.byteLength ||
        row.bytes > ringFirmwareLimit || digest(row.package) !== row.sha256) {
      throw new NotFoundException("固件暂不可用");
    }
    return row.package;
  }

  async list() {
    return { entries: await this.db.ringFirmwareRelease.findMany({
      select: { ...releaseFields, evidence: true },
      orderBy: { createdAt: "desc" }, take: 75,
    }) };
  }

  async stage(input: unknown, file?: Express.Multer.File) {
    const body = safeObject(input);
    const target = firmwareDevice(input);
    const version = identityText(body.version);
    const expected = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
    if (!file || file.size < 1 || file.size > ringFirmwareLimit || expected !== digest(file.buffer) ||
        target.fromVersion === version) throw new BadRequestException("文件、校验值或版本不匹配");
    const evidence = cleanText(body.evidence, 240);
    if (!evidence) throw new BadRequestException("请填写原厂适配及实测记录");
    const minBuild = boundedInteger(body.minBuild, 1, 2_147_483_647);
    const minBattery = boundedInteger(body.minBattery, 1, 100);
    return this.db.ringFirmwareRelease.create({
      data: { ...target, version, sha256: expected, bytes: file.size, package: Uint8Array.from(file.buffer),
        minBuild, minBattery, evidence },
      select: releaseFields,
    });
  }

  async enable(id: string, input: unknown) {
    const rowId = ringUuid(id);
    const { enabled } = safeObject(input);
    if (typeof enabled !== "boolean") throw new BadRequestException("请选择启用状态");
    if (enabled) {
      ringEnabled("firmware");
      this.privateKey();
      const row = await this.db.ringFirmwareRelease.findUnique({ where: { id: rowId }, select: releaseFields });
      if (!row || !firmwareQualified(row)) throw new ConflictException("该型号和升级路径尚未加入真机验证清单");
    }
    return this.db.ringFirmwareRelease.update({
      where: { id: rowId }, data: { enabled }, select: releaseFields,
    });
  }

  private privateKey() {
    try {
      const configured = process.env.SAY_RING_FIRMWARE_SIGNING_KEY_B64;
      if (!configured) throw new Error();
      const key = createPrivateKey({ key: Buffer.from(configured, "base64"), format: "der", type: "pkcs8" });
      if (key.asymmetricKeyType !== "ed25519") throw new Error();
      return key;
    } catch {
      throw new NotFoundException("固件签名尚未配置");
    }
  }
}
