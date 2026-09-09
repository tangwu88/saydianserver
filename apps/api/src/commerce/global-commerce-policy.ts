import { getCountries } from "libphonenumber-js";
import { safeObject } from "../common/crypto";
import { globalError, internationalPhone } from "../auth/global-identity";

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
    // Existing CNY adapters have not been validated as international payment rails.
    // Discovery may advertise currency, but checkout stays off until a real market-priced rail is implemented.
    return [{ countryCode, currency, currencyExponent, commerceEnabled: false, paymentChannels: [] }];
  });
}
