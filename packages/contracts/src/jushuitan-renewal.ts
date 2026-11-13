export const jstRenewalKey = "jushuitan_token_renewal";
export const jstDay = 86400_000;
export type JstRenewal = { enabled: boolean; issuedAt: string; expiresAt: string; nextAttemptAt: string; status: string; message: string; attemptedAt?: string; renewedAt?: string; secretVersion?: string };
export function jstRenewalPlan(issuedAt: string, expiresAt: string) {
  const issued = Date.parse(issuedAt), expires = Date.parse(expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued + 16 * jstDay) throw new Error("令牌有效期不足，无法安排15天后的安全续期");
  return new Date(Math.max(issued + 16 * jstDay, expires - 3 * jstDay)).toISOString();
}
export function jstRenewalDue(value: JstRenewal, now: number): "WAIT" | "EXPIRED" | "UNCERTAIN" | "DUE" {
  if (!value.enabled) return "WAIT";
  if (!Number.isFinite(Date.parse(value.expiresAt)) || now >= Date.parse(value.expiresAt)) return "EXPIRED";
  if (value.status === "RUNNING") return now - Date.parse(value.attemptedAt || "") > 120_000 ? "UNCERTAIN" : "WAIT";
  if (!Number.isFinite(Date.parse(value.issuedAt)) || !Number.isFinite(Date.parse(value.nextAttemptAt))) return "UNCERTAIN";
  return now >= Date.parse(value.nextAttemptAt) && now >= Date.parse(value.issuedAt) + 16 * jstDay ? "DUE" : "WAIT";
}
