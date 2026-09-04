import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function normalizedMobile(value: unknown): string {
  const mobile = String(value ?? "").replace(/\s+/g, "");
  if (!/^1\d{10}$/.test(mobile)) return "";
  return mobile;
}

export function maskMobile(value: string | null | undefined): string | undefined {
  if (!value || value.length < 7) return undefined;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export function safeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
