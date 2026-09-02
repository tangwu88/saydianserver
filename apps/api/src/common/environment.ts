import { randomBytes } from "node:crypto";

const developmentDefaults = new Map<string, string>([
  ["ACCESS_TOKEN_SECRET", randomBytes(48).toString("base64url")],
  ["REFRESH_TOKEN_PEPPER", randomBytes(48).toString("base64url")],
]);

export function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  if (process.env.NODE_ENV !== "production") {
    const generated = developmentDefaults.get(name);
    if (generated) return generated;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

export function envBoolean(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

export function assertProductionEnvironment(): void {
  if (process.env.NODE_ENV !== "production") return;
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_PEPPER",
  ]) {
    const value = env(key);
    if (value.length < 32 && key.includes("SECRET")) {
      throw new Error(`${key} must contain at least 32 characters`);
    }
  }
  if (envBoolean("ALLOW_TEST_OTP")) {
    throw new Error("ALLOW_TEST_OTP must be disabled in production");
  }
}
