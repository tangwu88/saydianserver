import { getCountries } from "libphonenumber-js";
import { safeObject } from "../common/crypto";
import { globalError, internationalPhone } from "../auth/global-identity";
import { createPrivateKey, createPublicKey } from "node:crypto";

export function globalAddress(input: unknown) {
  const body = safeObject(input);
  const countryCode = String(body.countryCode ?? "").toUpperCase();
  if (!getCountries().some(country => country === countryCode)) throw globalError(400, "invalid_country", "Select a valid country or region.");
  const phone = internationalPhone(body.mobile ?? body.phone);
  if (!phone) throw globalError(400, "invalid_phone", "Enter a valid international contact number.");
  const field = (value: unknown, max: number, required = false) => {
    const text = String(value ?? "").trim();
    if ((required && !text) || text.length > max) throw globalError(400, "invalid_address", "Check your delivery address and try again.");
    return text;
  };
  return { countryCode, mobile: phone.identifier, name: field(body.name, 100, true), province: field(body.province ?? body.region, 100), city: field(body.city, 100), district: field(body.district, 100), detail: field(body.detail ?? body.addressLine1, 500, true), postalCode: field(body.postalCode, 32) || null };
}

export type GlobalMarket = { countryCode: string; currency: string; currencyExponent: number; commerceEnabled: boolean; paymentChannels: string[] };
export const globalCommerceCountry = "CN";
export const globalCommerceCurrency = "CNY";
export const globalCommercePaymentChannels = ["WECHAT_JSAPI", "WECHAT_H5", "WECHAT_NATIVE", "ALIPAY_WAP", "ALIPAY_PAGE"] as const;

/** Shared public readiness and dispatch preflight; never returns credential material. */
export function globalPaymentConfigurationReady(channel: string, config: Record<string, unknown>, secret: Record<string, string | undefined>, publicBaseUrl: string): boolean {
  const wechat = channel.startsWith("WECHAT");
  const notify = String(config.notifyUrl ?? `${publicBaseUrl}/api/saydian-app/v2/billing/payments/${wechat ? "wechat" : "alipay"}/notify`);
  if (!securePaymentEndpoint(notify)) return false;
  if (wechat) return !!secret.merchantId && !!secret.serialNo && !!secret.platformSerialNo &&
    Buffer.byteLength(secret.apiV3Key ?? "") === 32 && paymentRsaKey(secret.privateKeyPem, true) &&
    paymentRsaKey(secret.platformPublicKeyPem, false) && /^wx[A-Za-z0-9]{8,64}$/.test(secret.appIdOfficial ?? "");
  try {
    const gateway = new URL(String(config.gateway ?? "https://openapi.alipay.com/gateway.do"));
    return !!secret.appId && paymentRsaKey(secret.privateKeyPem, true) && paymentRsaKey(secret.publicKeyPem, false) &&
      securePaymentEndpoint(gateway.toString()) && gateway.protocol === "https:" && (!gateway.port || gateway.port === "443") &&
      ["openapi.alipay.com", "openapi-sandbox.dl.alipaydev.com", "openapi.alipaydev.com"].includes(gateway.hostname) && gateway.pathname === "/gateway.do";
  } catch { return false; }
}

export function paymentRsaKey(pem: string | undefined, privateKey: boolean): boolean {
  if (!pem) return false;
  try { return (privateKey ? createPrivateKey(pem) : createPublicKey(pem)).asymmetricKeyType === "rsa"; } catch { return false; }
}
export function securePaymentEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}

/** No separate international price book exists: only the existing CNY/CN offer is supported. */
export function configuredGlobalMarkets(config: { enabled: boolean; value: unknown } | null): GlobalMarket[] {
  if (!config) return [{ countryCode: globalCommerceCountry, currency: globalCommerceCurrency, currencyExponent: 2, commerceEnabled: true, paymentChannels: [] }];
  return config.enabled ? globalMarkets(config.value) : [];
}

/** Explicit operational country/price/currency configuration, never inferred from UI language. */
export function globalMarkets(value: unknown): GlobalMarket[] {
  const body = safeObject(value);
  const items = Array.isArray(body.markets) ? body.markets : [];
  const seen = new Set<string>();
  return items.flatMap(item => {
    const market = safeObject(item);
    const countryCode = String(market.countryCode ?? "");
    const currency = String(market.currency ?? "");
    if (market.enabled !== true || seen.has(countryCode) || !getCountries().some(country => country === countryCode) || !Intl.supportedValuesOf("currency").includes(currency)) return [];
    const currencyExponent = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits!;
    seen.add(countryCode);
    // Market metadata never claims payment readiness; capabilities validate actual providers separately.
    return [{ countryCode, currency, currencyExponent, commerceEnabled: countryCode === globalCommerceCountry && currency === globalCommerceCurrency && market.commerceEnabled !== false, paymentChannels: [] }];
  });
}
