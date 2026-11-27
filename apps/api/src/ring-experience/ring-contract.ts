import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { safeObject } from "../common/crypto";

export const ringPublicPath = "/global/say-ring";
export const ringProduct = "say-ring";
export const cnRingProduct = "saydian-app-cn";
export type RingProduct = typeof ringProduct | typeof cnRingProduct;
export const cnRingRevision = "cn-ring-v1";

export function ringClientProduct(input: unknown): RingProduct {
  if (input === undefined || input === "" || input === ringProduct) return ringProduct;
  if (input === cnRingProduct) return cnRingProduct;
  throw new BadRequestException("产品标识不正确");
}

export function ringClientAvailability(input: unknown, revision: unknown) {
  const product = ringClientProduct(input);
  const available = ringAvailability();
  if (product === ringProduct) return available;
  const ready = revision === cnRingRevision;
  return { product, sharing: ready && available.sharing, care: ready && available.care,
    firmware: false, clientUpgradeRequired: !ready };
}

export function ringAvailability() {
  const china = process.env.DEPLOYMENT_SITE !== "us";
  return {
    sharing: china && process.env.SAY_RING_SHARING_ENABLED === "true",
    care: china && process.env.SAY_RING_CARE_ENABLED === "true",
    firmware: china && process.env.SAY_RING_FIRMWARE_ENABLED === "true",
  };
}

export function ringEnabled(feature: keyof ReturnType<typeof ringAvailability>) {
  if (!ringAvailability()[feature]) throw new NotFoundException("暂不可用");
}

export function ringUuid(value: unknown) {
  if (typeof value !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new BadRequestException("记录编号无效");
  }
  return value.toLowerCase();
}

export function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function shareToken(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) ||
      Buffer.from(value, "base64url").toString("base64url") !== value) {
    throw new NotFoundException("链接已失效");
  }
  return value;
}

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newInviteCode() {
  return Array.from(randomBytes(20), (value) => inviteAlphabet[value & 31]).join("");
}

export function inviteCode(value: unknown) {
  const code = typeof value === "string" && value.length <= 32
    ? value.replace(/[\s-]/g, "").toUpperCase()
    : "";
  if (!/^[A-HJ-NP-Z2-9]{20}$/.test(code)) throw new NotFoundException("邀请已失效");
  return code;
}

export function cleanText(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestException("内容格式不正确");
  }
  return value.trim();
}

export function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException("日期无效");
  }
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException("日期无效");
  }
  return value;
}

const sleep = ["sleepMinutes", "deepMinutes", "lightMinutes", "remMinutes",
  "awakeMinutes", "sleepStart", "sleepEnd", "sleepScore", "sleepAverageMinutes",
  "recordDays", "rangeEnd"];
const workout = ["sportName", "sportMinutes", "distanceKm", "steps", "heartRate"];
const health = ["systolic", "diastolic", "pulse", "heartRate", "hrv", "oxygen",
  "temperatureC", "steps", "distanceKm", "bloodGlucose", "stress", "measuredTime"];
const fieldsByKind = {
  sleep,
  health,
  workout,
  week: ["sleepMinutes", "sportName", "sportMinutes", "distanceKm", "steps", "recordDays",
    "rangeEnd", "sleepAverageMinutes", "previousSleepAverageMinutes", "previousSportMinutes"],
} as const;

export function ringSnapshot(input: unknown) {
  const body = safeObject(input);
  const kind = body.kind;
  if (typeof kind !== "string" || !Object.hasOwn(fieldsByKind, kind)) {
    throw new BadRequestException("分享类型无效");
  }
  const allowed = fieldsByKind[kind as keyof typeof fieldsByKind];
  if (!Array.isArray(body.fields) || body.fields.length === 0 || body.fields.length > allowed.length) {
    throw new BadRequestException("请选择分享内容");
  }
  const used = new Set<string>();
  const fields = body.fields.map((entry: unknown) => {
    const { key, value } = safeObject(entry);
    if (typeof key !== "string" || !allowed.includes(key as never) || used.has(key)) {
      throw new BadRequestException("分享字段无效");
    }
    used.add(key);
    if (key === "sportName") {
      const label = cleanText(value, 50);
      if (!label) throw new BadRequestException("运动名称无效");
      return { key, value: label };
    }
    if (["sleepStart", "sleepEnd", "measuredTime"].includes(key)) {
      if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new BadRequestException("记录时间无效");
      }
      return { key, value };
    }
    if (key === "rangeEnd") return { key, value: calendarDate(value) };
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
      throw new BadRequestException("记录数值无效");
    }
    return { key, value };
  });
  return {
    kind,
    date: calendarDate(body.date),
    fields,
    note: cleanText(body.note ?? "", 140),
  };
}

export const reactionKinds = ["cheer", "hug", "walk"] as const;
export const careMessageKinds = ["thinking", "thinkingBack", "walked", "resting",
  "call", "voice"] as const;

export function careAudio(input: unknown): Uint8Array {
  if (typeof input !== "string" || input.length > 1_281_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) throw new BadRequestException("语音格式无效");
  const bytes = Buffer.from(input, "base64");
  // The recorder emits PCM, accepted only after parsing its duration.
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.readUInt32LE(4) !== bytes.length - 8 ||
      bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new BadRequestException("语音格式无效");
  }
  let rate = 0;
  let size = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    const end = at + 8 + length;
    if (end > bytes.length) throw new BadRequestException("语音格式无效");
    if (id === "fmt " && length >= 16 && rate === 0) {
      rate = bytes.readUInt32LE(at + 12);
      if (bytes.readUInt16LE(at + 8) !== 1 || bytes.readUInt16LE(at + 10) !== 1 ||
          bytes.readUInt32LE(at + 16) !== rate * 2 || bytes.readUInt16LE(at + 20) !== 2 ||
          bytes.readUInt16LE(at + 22) !== 16 || rate < 8000 || rate > 48000) {
        throw new BadRequestException("语音格式无效");
      }
    }
    if (id === "data") {
      if (size !== 0) throw new BadRequestException("语音格式无效");
      size = length;
    }
    at = end + (length % 2);
  }
  if (!rate || !size || size % 2 !== 0 || size > rate * 2 * 10) {
    throw new BadRequestException("语音最多 10 秒");
  }

  // Deliver a canonical WAV. Private metadata and ancillary chunks do not leave the sender.
  const canonical = Buffer.allocUnsafe(44 + size);
  const dataChunk = findAudioData(bytes);
  canonical.write("RIFF", 0);
  canonical.writeUInt32LE(36 + size, 4);
  canonical.write("WAVEfmt ", 8);
  canonical.writeUInt32LE(16, 16);
  canonical.writeUInt16LE(1, 20);
  canonical.writeUInt16LE(1, 22);
  canonical.writeUInt32LE(rate, 24);
  canonical.writeUInt32LE(rate * 2, 28);
  canonical.writeUInt16LE(2, 32);
  canonical.writeUInt16LE(16, 34);
  canonical.write("data", 36);
  canonical.writeUInt32LE(size, 40);
  bytes.copy(canonical, 44, dataChunk, dataChunk + size);
  return canonical;
}

function findAudioData(bytes: Buffer) {
  for (let at = 12; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(at + 4);
    if (bytes.toString("ascii", at, at + 4) === "data") return at + 8;
    at += 8 + length + (length % 2);
  }
  throw new BadRequestException("语音内容为空");
}

export function currentCareWeek(now = new Date()) {
  // Say Ring's shared week uses one calendar for both participants.
  const china = new Date(+now + 8 * 3_600_000);
  china.setUTCHours(0, 0, 0, 0);
  const today = china.toISOString().slice(0, 10);
  china.setUTCDate(china.getUTCDate() - (china.getUTCDay() + 6) % 7);
  return { week: china.toISOString().slice(0, 10), today };
}
