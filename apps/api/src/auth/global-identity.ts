import { HttpException } from "@nestjs/common";
import { domainToASCII } from "node:url";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const globalLocales = ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"] as const;
export type GlobalLocale = typeof globalLocales[number];
export type VerificationChannel = "email" | "sms";
export type VerificationPurpose = "register" | "reset_password";

export function globalError(status: number, errorKey: string, message: string): HttpException {
  return new HttpException({ message, errorKey }, status);
}

export function globalLocale(value: unknown): GlobalLocale {
  const raw = String(value ?? "en").split(",")[0]!.split(";")[0]!.trim().replace(/_/g, "-");
  if (/^zh-(TW|HK|MO|Hant)(-|$)/i.test(raw)) return "zh-Hant";
  if (/^zh(-|$)/i.test(raw)) return "zh-Hans";
  return globalLocales.find(locale => locale.toLowerCase() === raw.toLowerCase())
    ?? globalLocales.find(locale => locale === raw.split("-")[0]?.toLowerCase()) ?? "en";
}

export function normalizedEmail(value: unknown): string {
  const input = String(value ?? "").trim();
  if (input.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return "";
  const [local, host] = input.split("@");
  const domain = domainToASCII(host ?? "").toLowerCase();
  if (!local || local.length > 64 || !domain || !/^[a-z0-9.-]+$/.test(domain) ||
      domain.split(".").some(part => !part || part.startsWith("-") || part.endsWith("-")) ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "";
  return `${local.toLowerCase()}@${domain}`;
}

export function internationalPhone(value: unknown): { identifier: string; country: string } | null {
  const input = String(value ?? "").trim();
  if (!input.startsWith("+") || input.length > 32) return null;
  const phone = parsePhoneNumberFromString(input, { extract: false });
  if (!phone || !phone.isValid() || phone.ext || !phone.country) return null;
  return { identifier: phone.number, country: phone.country };
}

export function globalIdentity(channelInput: unknown, identifierInput: unknown) {
  const channel = String(channelInput ?? "");
  if (channel === "email") {
    const identifier = normalizedEmail(identifierInput);
    if (identifier) return { channel: "email" as const, identifier, country: null };
  } else if (channel === "sms") {
    const phone = internationalPhone(identifierInput);
    if (phone) return { channel: "sms" as const, ...phone };
  }
  throw globalError(400, "invalid_identifier", "Enter a valid email address or international phone number.");
}

export function maskedIdentifier(channel: string, identifier: string): string {
  if (channel === "email") {
    const [local, domain] = identifier.split("@");
    return `${local!.slice(0, 1)}***@${domain}`;
  }
  return `${identifier.slice(0, 3)}***${identifier.slice(-4)}`;
}
