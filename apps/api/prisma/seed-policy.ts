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
  return Boolean(environment.MALL_SERVICE_TOKEN?.trim());
}
