export const OAUTH_TTL = 10 * 60 * 1000;
export const OAUTH_CONTEXT_KEY = "saydian-global-mall:oauth-context";
export const OAUTH_CALLBACK_PATH = "/global/saidian-mall/oauth/callback";
export type OAuthContext = { state: string; verifier: string; consentVersion: string; locale: string; expiresAt: number; returnTo: string; sessionStamp: string };
export function validOAuthContext(value: unknown, now: number): value is OAuthContext {
  const c = value as OAuthContext | null;
  return !!c && typeof c.state === "string" && c.state.length >= 16 && c.state.length <= 256 && /^[A-Za-z0-9_-]+$/.test(c.state)
    && typeof c.verifier === "string" && /^[a-f0-9]{64}$/.test(c.verifier)
    && typeof c.consentVersion === "string" && !!c.consentVersion && c.consentVersion.length <= 80
    && ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"].includes(c.locale)
    && Number.isFinite(c.expiresAt) && c.expiresAt > now && c.expiresAt <= now + OAUTH_TTL
    && typeof c.returnTo === "string" && typeof c.sessionStamp === "string";
}
export function consumeOAuthContext(storage: Pick<Storage, "getItem" | "removeItem">, state: string, now = Date.now()): OAuthContext {
  const raw = storage.getItem(OAUTH_CONTEXT_KEY);
  // Consume before network/JSON parsing so an error or refresh cannot replay a code.
  storage.removeItem(OAUTH_CONTEXT_KEY);
  let context: unknown;
  try { context = JSON.parse(raw || "null"); } catch { throw new Error("微信授权信息已失效，请重新授权"); }
  if (!validOAuthContext(context, now) || context.state !== state) throw new Error("微信授权已过期或校验不一致，请重新授权");
  return context;
}
export function validGlobalIdentifier(value: string, channel?: "email" | "sms") {
  const text = value.trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 254;
  const phone = /^\+[1-9]\d{6,14}$/.test(text);
  return channel === "email" ? email : channel === "sms" ? phone : email || phone;
}
export function validNewPassword(value: string) { return value.length >= 8 && new TextEncoder().encode(value).length <= 72; }
export function globalLegalPath(value: unknown): string {
  if (typeof value !== "string" || !/^\/api\/saydian-app\/v2\/content\/legal\/(user_agreement|privacy_policy)\?[^#]*$/.test(value) || /[\\\r\n]/.test(value)) throw new Error("协议暂时无法查看，请稍后重试。");
  const url = new URL(value, "https://app.saydian.cn");
  if (!url.searchParams.get("version") || !url.searchParams.get("locale")) throw new Error("协议已更新，请刷新后重试。");
  return "/global" + value;
}
export {
  normalizeGlobalPhone,
  splitGlobalPhone,
  type PhoneCountryCode,
} from "./country-phone";
