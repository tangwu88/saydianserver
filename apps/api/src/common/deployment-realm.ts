export function authIssuer(): string {
  // Keep the deployed issuer so existing access and refresh sessions survive cutover.
  return "saydian-global-server";
}

export function authAudience(): string {
  return "saydian-global-app";
}

export function assertDeploymentRealm(
  environment: Record<string, string | undefined> = process.env,
): void {
  if (/^(true|1|yes)$/i.test(environment.LEGACY_SESSION_BRIDGE_ENABLED ?? "")) {
    throw new Error(
      "Legacy session import must remain disabled in the unified deployment",
    );
  }
  if (
    environment.AUTH_ISSUER &&
    environment.AUTH_ISSUER !== "saydian-global-server"
  ) {
    throw new Error("AUTH_ISSUER must preserve the existing account domain");
  }
  if (
    environment.AUTH_AUDIENCE &&
    environment.AUTH_AUDIENCE !== "saydian-global-app"
  ) {
    throw new Error("AUTH_AUDIENCE must preserve the existing account domain");
  }
  if (environment.NODE_ENV === "production") {
    const publicBase = new URL(environment.PUBLIC_BASE_URL ?? "");
    if (
      publicBase.origin !== "https://app.saydian.cn" ||
      publicBase.pathname !== "/" ||
      publicBase.search ||
      publicBase.hash
    ) {
      throw new Error("PUBLIC_BASE_URL must be https://app.saydian.cn");
    }
  }
}
