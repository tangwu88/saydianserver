type SeedEnvironment = Record<string, string | undefined>;

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

export function shouldSeedPreviewContent(
  environment: SeedEnvironment = process.env,
): boolean {
  if (environment.SEED_PREVIEW_CONTENT !== undefined) {
    return enabled(environment.SEED_PREVIEW_CONTENT);
  }
  return environment.NODE_ENV !== "production";
}

export function hasConfiguredObjectStorage(
  environment: SeedEnvironment = process.env,
): boolean {
  return [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
  ].every((key) => Boolean(environment[key]?.trim()));
}

export function hasConfiguredCommerce(
  environment: SeedEnvironment = process.env,
): boolean {
  return environment.COMMERCE_MODE?.trim().toLowerCase() !== "external";
}

export function hasConfiguredWechatPay(
  environment: SeedEnvironment = process.env,
): boolean {
  return [
    "WECHAT_PAY_MERCHANT_ID",
    "WECHAT_PAY_SERIAL_NO",
    "WECHAT_PAY_PRIVATE_KEY_PEM",
    "WECHAT_PAY_API_V3_KEY",
    "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM",
    "WECHAT_PAY_PLATFORM_SERIAL_NO",
  ].every((key) => Boolean(environment[key]?.trim()));
}

export function hasConfiguredAlipay(
  environment: SeedEnvironment = process.env,
): boolean {
  return ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY_PEM", "ALIPAY_PUBLIC_KEY_PEM"].every(
    (key) => Boolean(environment[key]?.trim()),
  );
}

export function hasConfiguredWeCom(
  environment: SeedEnvironment = process.env,
): boolean {
  return [
    "WECOM_CORP_ID",
    "WECOM_AGENT_ID",
    "WECOM_SECRET",
    "COMMERCE_STOREFRONT_URL",
  ].every((key) => Boolean(environment[key]?.trim()));
}
