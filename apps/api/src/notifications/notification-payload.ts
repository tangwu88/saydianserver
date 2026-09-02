import { safeObject } from "../common/crypto";

const allowedKeys = new Set(["eventId", "type", "deepLink"]);
const forbiddenKeyPattern = /(mobile|phone|token|secret|health|value|blood|heart|glucose)/i;

export function publicPushPayload(value: unknown): Record<string, string> {
  const source = safeObject(value);
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (!allowedKeys.has(key) || forbiddenKeyPattern.test(key)) continue;
    const text = String(raw ?? "").trim();
    if (text && text.length <= 512) result[key] = text;
  }
  return result;
}
