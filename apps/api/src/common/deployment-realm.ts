/** Account isolation is deployment-owned. Never resolve it from request headers. */
export function isGlobalRealm(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.APP_REALM === "global";
}

export function authIssuer(): string {
  return isGlobalRealm() ? "saydian-global-server" : "saydianapp-server";
}

export function authAudience(): string {
  return isGlobalRealm() ? "saydian-global-app" : "saydian-app";
}

export function assertDeploymentRealm(environment: Record<string, string | undefined> = process.env): void {
  if (environment.APP_REALM && !["domestic", "global"].includes(environment.APP_REALM)) {
    throw new Error("APP_REALM must be domestic or global");
  }
  if (!isGlobalRealm(environment)) return;
  if (/^(true|1|yes)$/i.test(environment.LEGACY_SESSION_BRIDGE_ENABLED ?? "")) {
    throw new Error("Legacy session import must remain disabled in the global deployment");
  }
  if (environment.AUTH_ISSUER && environment.AUTH_ISSUER !== "saydian-global-server") {
    throw new Error("Global AUTH_ISSUER must identify the global account domain");
  }
  if (environment.AUTH_AUDIENCE && environment.AUTH_AUDIENCE !== "saydian-global-app") {
    throw new Error("Global AUTH_AUDIENCE must identify the global app");
  }
  if (environment.NODE_ENV === "production") {
    const publicBase = new URL(environment.PUBLIC_BASE_URL ?? "");
    if (publicBase.origin !== "https://app.saydian.cn" || publicBase.pathname.replace(/\/$/, "") !== "/global") {
      throw new Error("Global PUBLIC_BASE_URL must be https://app.saydian.cn/global");
    }
    const database = new URL(environment.DATABASE_URL ?? "");
    if (!database.pathname.toLowerCase().includes("global")) {
      throw new Error("Global deployment requires a dedicated global database");
    }
  }
}
