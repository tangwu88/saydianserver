// Explicit isolated H5 demo launcher. Never loads the existing API .env.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { dirname, resolve, join } from "node:path";
import { privateDemoPaths, demoDatabase as database, validateDemoProfile } from "./h5-demo-profile.mjs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];
const profilePath = process.argv[3];
const profile = privateDemoPaths(repo, profilePath);
assert.ok(["prepare", "init-db", "migrate", "seed", "api", "admin", "shop"].includes(action), "Unknown demo action");
const apiRequire = createRequire(join(repo, "apps/api/package.json"));
if (action === "prepare") {
  const url = database(process.env.H5_DEMO_DATABASE_URL);
  const secret = () => randomBytes(48).toString("base64url");
  const settings = {
    NODE_ENV: "development", H5_DEMO_ENABLED: "true", DATABASE_URL: url.toString(),
    HOST: "127.0.0.1", PORT: "8081", PUBLIC_BASE_URL: "http://127.0.0.1:8081",
    CORS_ORIGINS: "http://127.0.0.1:5174,http://127.0.0.1:5175,http://localhost:5174,http://localhost:5175",
    COMMERCE_MODE: "integrated", COMMERCE_STOREFRONT_URL: "http://127.0.0.1:5174/saidian-mall",
    ACCESS_TOKEN_SECRET: secret(), EMPLOYEE_TOKEN_SECRET: secret(), REFRESH_TOKEN_PEPPER: secret(),
    INTEGRATION_MASTER_KEY: randomBytes(32).toString("hex"),
    ALLOW_TEST_OTP: "true", SMS_PROVIDER: "disabled", ENABLE_PUBLIC_DOCS: "false",
    MAINTENANCE_READ_ONLY: "false", BUSINESS_WRITES_PAUSED: "false",
    WORKER_OUTBOUND_PAUSED: "true", CALLBACK_PROCESSING_PAUSED: "true",
    LEGACY_SESSION_BRIDGE_ENABLED: "false", LEGACY_TOKEN_EXCHANGE_ENABLED: "false",
    VITE_API_BASE: "/api/saidian-mall/v1",
    VITE_API_PROXY_TARGET: "http://127.0.0.1:8081", VITE_H5_DEMO: "true",
    H5_DEMO_ADMIN_USERNAME: "h5-demo-admin", H5_DEMO_ADMIN_PASSWORD: secret(),
    H5_DEMO_SESSION_PATH: join(dirname(profile), "employee-session.json"),
    DOTENV_CONFIG_PATH: profile, DOTENV_CONFIG_QUIET: "true",
    TS_NODE_PROJECT: join(repo, "apps/api/tsconfig.json"),
  };
  validateDemoProfile(settings, repo, profile);
  await mkdir(dirname(profile), { recursive: true });
  // Exclusive create: reruns never rotate a running profile or erase data.
  await writeFile(profile, Object.entries(settings).map(([key, value]) => key + "=" + JSON.stringify(value)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  console.log("Created isolated demo profile; credentials withheld. Restrict its Windows ACL to the current user.");
} else {
  const settings = parseEnv(await readFile(profile, "utf8"));
  const url = validateDemoProfile(settings, repo, profile);
  // Explicit whitelist prevents inherited production credentials/NODE_OPTIONS.
  const childEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PATHEXT", "HOME"]) {
    if (process.env[key] !== undefined) childEnv[key] = process.env[key];
  }
  Object.assign(childEnv, settings, { DOTENV_CONFIG_PATH: profile, DOTENV_CONFIG_QUIET: "true", TS_NODE_PROJECT: join(repo, "apps/api/tsconfig.json") });
  if (action === "init-db") {
    const { Client } = createRequire(join(repo, "apps/migrator/package.json"))("pg");
    const controlUrl = new URL(url); controlUrl.pathname = "/postgres";
    const client = new Client({ connectionString: controlUrl.toString() });
    try {
      await client.connect();
      if (!(await client.query("SELECT 1 FROM pg_database WHERE datname = $1", ["saydian_h5_demo"])).rowCount) {
        await client.query('CREATE DATABASE "saydian_h5_demo"');
      }
      console.log("Dedicated demo database exists; existing databases were not changed.");
    } finally { await client.end(); }
  } else {
    const bin = (packageDir, name, path) => join(dirname(createRequire(join(repo, packageDir, "package.json")).resolve(name + "/package.json")), path);
    const commands = {
      migrate: { cwd: join(repo, "apps/api"), args: [bin("apps/api", "prisma", "build/index.js"), "migrate", "deploy", "--schema", join(repo, "apps/api/prisma/schema.prisma")] },
      seed: { cwd: dirname(profile), args: [join(repo, "tools/seed-h5-demo.mjs")] },
      api: { cwd: dirname(profile), args: ["-r", join(repo, "tools/h5-demo-network-guard.cjs"), "-r", apiRequire.resolve("ts-node/register/transpile-only"), join(repo, "apps/api/src/main.ts")] },
      admin: { cwd: join(repo, "apps/admin-web"), args: [bin("apps/admin-web", "vite", "bin/vite.js"), "--host", "127.0.0.1", "--port", "5175", "--strictPort"] },
      shop: { cwd: join(repo, "apps/shop"), args: [bin("apps/shop", "@dcloudio/vite-plugin-uni", "bin/uni.js"), "-p", "h5", "--host", "127.0.0.1", "--port", "5174", "--strictPort"] },
    };
    const command = commands[action];
    const child = spawn(process.execPath, command.args, { cwd: command.cwd, env: childEnv, stdio: "inherit", windowsHide: true, shell: false });
    child.on("error", () => { console.error("Demo child could not start; connection details withheld"); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  }
}
