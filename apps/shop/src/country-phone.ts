import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

export type PhoneCountryCode = CountryCode;

export type PhoneCountryOption = {
  country: PhoneCountryCode;
  name: string;
  callingCode: string;
  search: string;
};

function regionName(country: PhoneCountryCode, locale: string): string {
  try {
    const DisplayNames = (
      Intl as unknown as {
        DisplayNames?: new (
          locales: string[],
          options: { type: "region" },
        ) => { of(value: string): string | undefined };
      }
    ).DisplayNames;
    return DisplayNames
      ? new DisplayNames([locale, "en"], { type: "region" }).of(country) ??
          country
      : country;
  } catch {
    return country;
  }
}

export function phoneCountryOptions(locale = "zh-CN"): PhoneCountryOption[] {
  return getCountries()
    .map((country) => {
      const name = regionName(country, locale);
      const callingCode = `+${getCountryCallingCode(country)}`;
      return {
        country,
        name,
        callingCode,
        search: `${name} ${country} ${callingCode}`.toLocaleLowerCase(),
      };
    })
    .sort((left, right) => {
      if (left.country === "CN") return -1;
      if (right.country === "CN") return 1;
      return left.name.localeCompare(right.name, locale);
    });
}

function countryForCallingCode(callingCode: string): PhoneCountryCode | null {
  const matches = getCountries().filter(
    (country) => `+${getCountryCallingCode(country)}` === callingCode,
  );
  return matches.length === 1 ? matches[0]! : null;
}

export function normalizeGlobalPhone(
  value: string,
  countryOrCallingCode: PhoneCountryCode | string = "CN",
): string | null {
  const input = value.trim();
  if (!input || input.length > 32) return null;
  const country = /^[A-Z]{2}$/.test(countryOrCallingCode)
    ? (countryOrCallingCode as PhoneCountryCode)
    : countryForCallingCode(countryOrCallingCode.trim());
  try {
    // Use the string overload so this helper also behaves predictably in the
    // isolated browser/test realm. Reject letters first because the string
    // overload otherwise permits extracting a number from surrounding text.
    if (/[^\d+\s().-]/.test(input)) return null;
    const phone = input.startsWith("+")
      ? parsePhoneNumberFromString(input)
      : country
        ? parsePhoneNumberFromString(input, country)
        : parsePhoneNumberFromString(
            `${countryOrCallingCode.trim()}${input.replace(/[\s().-]/g, "")}`,
          );
    return phone?.isValid() && phone.country && !phone.ext
      ? phone.number
      : null;
  } catch {
    return null;
  }
}

export function splitGlobalPhone(value: string): {
  country: PhoneCountryCode;
  nationalNumber: string;
} | null {
  try {
    const input = value.trim();
    if (!input.startsWith("+") || /[^\d+\s().-]/.test(input)) return null;
    const phone = parsePhoneNumberFromString(input);
    return phone?.isValid() && phone.country && !phone.ext
      ? { country: phone.country, nationalNumber: phone.nationalNumber }
      : null;
  } catch {
    return null;
  }
}
