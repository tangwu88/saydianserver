// Shared, side-effect-free guards for this dedicated demo profile only.
import assert from "node:assert/strict";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const profileKeys = new Set([
  "NODE_ENV", "H5_DEMO_ENABLED", "DATABASE_URL", "HOST", "PORT", "PUBLIC_BASE_URL", "CORS_ORIGINS",
  "COMMERCE_MODE", "COMMERCE_STOREFRONT_URL", "ACCESS_TOKEN_SECRET", "EMPLOYEE_TOKEN_SECRET",
  "REFRESH_TOKEN_PEPPER", "INTEGRATION_MASTER_KEY", "ALLOW_TEST_OTP", "SMS_PROVIDER", "ENABLE_PUBLIC_DOCS",
  "MAINTENANCE_READ_ONLY", "BUSINESS_WRITES_PAUSED", "WORKER_OUTBOUND_PAUSED", "CALLBACK_PROCESSING_PAUSED",
  "LEGACY_SESSION_BRIDGE_ENABLED", "LEGACY_TOKEN_EXCHANGE_ENABLED", "VITE_API_BASE", "VITE_API_PROXY_TARGET",
  "VITE_H5_DEMO", "H5_DEMO_ADMIN_USERNAME", "H5_DEMO_ADMIN_PASSWORD", "H5_DEMO_SESSION_PATH",
  "DOTENV_CONFIG_PATH", "DOTENV_CONFIG_QUIET", "TS_NODE_PROJECT",
]);
function localAbsolutePath(value) {
  assert.ok(typeof value === "string" && isAbsolute(value) && !/^[\\/]{2}/.test(value) && !/^\\(?:\?\?|Device)\\/i.test(value), "Demo path must be absolute and local, not UNC/device");
  return resolve(value);
}
export function privateDemoPaths(repoInput, profileInput, sessionInput) {
  const repo = localAbsolutePath(repoInput), profile = localAbsolutePath(profileInput);
  const outside = relative(repo, profile);
  assert.ok(outside === ".." || outside.startsWith(".." + sep) || isAbsolute(outside), "Demo profile must be outside the repository");
  if (sessionInput !== undefined) {
    const session = localAbsolutePath(sessionInput);
    assert.equal(relative(dirname(profile), dirname(session)), "", "Demo session must be beside the private profile");
    assert.notEqual(relative(profile, session), "", "Demo session must not overwrite its profile");
  }
  return profile;
}
export function demoDatabase(value) {
  let url;
  try { url = new URL(value ?? ""); } catch { throw new Error("Invalid demo database URL; value withheld"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/saydian_h5_demo" && ["", "?schema=public"].includes(url.search) && !url.hash, "Only dedicated loopback saydian_h5_demo database is allowed");
  return url;
}
export function validateDemoProfile(settings, repo, profileInput) {
  for (const key of Object.keys(settings)) assert.ok(profileKeys.has(key), "Unexpected demo profile key: " + key);
  const profile = privateDemoPaths(repo, profileInput, settings.H5_DEMO_SESSION_PATH);
  assert.ok(settings.H5_DEMO_SESSION_PATH, "Private demo session path required");
  const exact = {
    NODE_ENV: "development", H5_DEMO_ENABLED: "true", HOST: "127.0.0.1", PORT: "8081",
    PUBLIC_BASE_URL: "http://127.0.0.1:8081", COMMERCE_MODE: "integrated",
    COMMERCE_STOREFRONT_URL: "http://127.0.0.1:5174/saidian-mall", ALLOW_TEST_OTP: "true", SMS_PROVIDER: "disabled",
    ENABLE_PUBLIC_DOCS: "false", WORKER_OUTBOUND_PAUSED: "true", CALLBACK_PROCESSING_PAUSED: "true",
    LEGACY_SESSION_BRIDGE_ENABLED: "false", LEGACY_TOKEN_EXCHANGE_ENABLED: "false",
    VITE_API_BASE: "/api/saidian-mall/v1", VITE_API_PROXY_TARGET: "http://127.0.0.1:8081", VITE_H5_DEMO: "true",
    H5_DEMO_ADMIN_USERNAME: "h5-demo-admin", DOTENV_CONFIG_QUIET: "true",
  };
  for (const [key, value] of Object.entries(exact)) assert.ok(settings[key] === value, "Invalid dedicated demo setting: " + key);
  assert.equal(resolve(settings.DOTENV_CONFIG_PATH ?? ""), profile, "Demo dotenv path must match private profile");
  assert.equal(resolve(settings.TS_NODE_PROJECT ?? ""), join(resolve(repo), "apps/api/tsconfig.json"), "Demo TypeScript config must match repository");
  return demoDatabase(settings.DATABASE_URL);
}
export function validateDemoSeedEnvironment(environment, repo) {
  // OS runtime variables are not profile input. Reject unsafe injection explicitly;
  // the launcher supplies only its OS allowlist plus validated profile settings.
  for (const key of Object.keys(environment)) {
    assert.ok(!["NODE_OPTIONS", "NODE_PATH"].includes(key) && !/^(WECHAT_|WECOM_|ALIPAY_|JUSHUITAN_|SMS_(?!PROVIDER$)|OBJECT_STORAGE_|APPLE_|PUSH_|AI_)/.test(key), "Unexpected injected demo environment key: " + key);
  }
  const settings = Object.fromEntries(Object.entries(environment).filter(([key]) => profileKeys.has(key)));
  return validateDemoProfile(settings, repo, environment.DOTENV_CONFIG_PATH);
}
