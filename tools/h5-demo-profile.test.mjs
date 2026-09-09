// The only child processes run temporary script copies with DB/spawn sentinels.
// No real profile, API, database, browser, supplier, or repository file is changed.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

const sourceTools = process.env.H5_PROFILE_TEST_SOURCE_DIR || dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "saydian-h5-profile-test-"));
const repo = join(temp, "repo"), privateDir = join(temp, "private"), profilePath = join(privateDir, ".env.h5-demo");
mkdirSync(join(repo, "tools"), { recursive: true }); mkdirSync(privateDir);
for (const name of ["h5-demo-profile.mjs", "h5-demo-runtime.mjs", "seed-h5-demo.mjs"]) writeFileSync(join(repo, "tools", name), readFileSync(join(sourceTools, name)));
const sentinel = join(temp, "sentinel.cjs");
writeFileSync(sentinel, `
const Module = require('node:module');
const load = Module._load, resolveFilename = Module._resolveFilename;
Module._load = function(request, ...args) {
  if (request === 'pg' || request === '@prisma/client') throw new Error('DB_IMPORT_SENTINEL');
  return load.call(this, request, ...args);
};
Module._resolveFilename = function(request, ...args) {
  if (['ts-node/register/transpile-only', 'prisma/package.json', 'vite/package.json', '@dcloudio/vite-plugin-uni/package.json'].includes(request)) return __filename;
  return resolveFilename.call(this, request, ...args);
};
require('node:child_process').spawn = () => { throw new Error('APP_SPAWN_SENTINEL'); };
Module.syncBuiltinESMExports();
`);
const osEnvironment = {};
for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PATHEXT", "HOME"]) if (process.env[key] !== undefined) osEnvironment[key] = process.env[key];
function execute(file, args = [], settings = {}) {
  return spawnSync(process.execPath, ["--require", sentinel, join(repo, "tools", file), ...args], { cwd: temp, env: { ...osEnvironment, ...settings }, encoding: "utf8", timeout: 10_000, windowsHide: true });
}
const prepared = execute("h5-demo-runtime.mjs", ["prepare", profilePath], { H5_DEMO_DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/saydian_h5_demo?schema=public" });
assert.equal(prepared.status, 0, "Temporary prepare must succeed without DB or spawn");
const valid = parseEnv(readFileSync(profilePath, "utf8"));
function replaceProfile(settings) { writeFileSync(profilePath, Object.entries(settings).map(([key, value]) => key + "=" + JSON.stringify(value)).join("\n") + "\n", { mode: 0o600 }); }
function rejectedBeforeSideEffect(result, expected) {
  assert.notEqual(result.status, 0, "Invalid input must be rejected");
  assert.match(result.stderr, expected);
  assert.doesNotMatch(result.stderr, /DB_IMPORT_SENTINEL|APP_SPAWN_SENTINEL/, "Validation must run before database import or application spawn");
}
after(() => {
  const resolved = resolve(temp);
  assert.ok(resolved.startsWith(resolve(tmpdir()) + sep) && basename(resolved).startsWith("saydian-h5-profile-test-"), "Cleanup remains within owned temporary directory");
  rmSync(resolved, { recursive: true, force: true });
});

test("normal prepare keys remain supported; valid runtime reaches only the stopped spawn sentinel", () => {
  replaceProfile(valid);
  const result = execute("h5-demo-runtime.mjs", ["api", profilePath]);
  assert.match(result.stderr, /APP_SPAWN_SENTINEL/);
  assert.doesNotMatch(result.stderr, /DB_IMPORT_SENTINEL/);
});
test("valid seed reaches only the stopped Prisma import sentinel", () => {
  const result = execute("seed-h5-demo.mjs", [], valid);
  assert.match(result.stderr, /DB_IMPORT_SENTINEL/);
});
test("runtime rejects a repository child beginning with two dots before file access", () => {
  const badPath = join(repo, "..private-demo", ".env.h5-demo");
  rejectedBeforeSideEffect(execute("h5-demo-runtime.mjs", ["prepare", badPath]), /profile must be outside the repository/);
});
test("runtime rejects UNC profile before file access", () => {
  const unc = process.platform === "win32" ? "\\\\example.invalid\\share\\demo.env" : "//example.invalid/share/demo.env";
  rejectedBeforeSideEffect(execute("h5-demo-runtime.mjs", ["init-db", unc]), /absolute and local, not UNC\/device/);
});
test("runtime rejects proxy/base/mode/callback drift before DB or spawn", () => {
  for (const change of [{ VITE_API_PROXY_TARGET: "http://127.0.0.1:8080" }, { VITE_API_BASE: "https://example.invalid/api" }, { COMMERCE_MODE: "proxy" }, { CALLBACK_PROCESSING_PAUSED: "false" }]) {
    replaceProfile({ ...valid, ...change });
    for (const action of ["init-db", "api", "admin", "shop"]) rejectedBeforeSideEffect(execute("h5-demo-runtime.mjs", [action, profilePath]), /Invalid dedicated demo setting/);
  }
});
test("runtime rejects extra profile keys including Node preloads and provider credentials", () => {
  for (const change of [{ NODE_OPTIONS: "--version" }, { NODE_PATH: "unused" }, { JUSHUITAN_APP_KEY: "synthetic-only" }, { WECHAT_PAY_API_V3_KEY: "synthetic-only" }, { UNEXPECTED_CONFIG: "unused" }]) {
    replaceProfile({ ...valid, ...change });
    rejectedBeforeSideEffect(execute("h5-demo-runtime.mjs", ["api", profilePath]), /Unexpected demo profile key/);
  }
});
test("seed refuses public/session-outside-profile paths and same-file overwrite before Prisma", () => {
  for (const path of [join(repo, "public", "employee-session.json"), join(temp, "elsewhere", "employee-session.json"), profilePath]) {
    rejectedBeforeSideEffect(execute("seed-h5-demo.mjs", [], { ...valid, H5_DEMO_SESSION_PATH: path }), /session must be beside|must not overwrite/);
  }
  const unc = process.platform === "win32" ? "\\\\example.invalid\\share\\session.json" : "//example.invalid/share/session.json";
  rejectedBeforeSideEffect(execute("seed-h5-demo.mjs", [], { ...valid, H5_DEMO_SESSION_PATH: unc }), /absolute and local, not UNC\/device/);
});
test("seed rejects non-private profile and injected provider key before Prisma", () => {
  const internal = join(repo, "..private-demo", "demo.env");
  rejectedBeforeSideEffect(execute("seed-h5-demo.mjs", [], { ...valid, DOTENV_CONFIG_PATH: internal, H5_DEMO_SESSION_PATH: join(dirname(internal), "session.json") }), /profile must be outside the repository/);
  rejectedBeforeSideEffect(execute("seed-h5-demo.mjs", [], { ...valid, WECOM_SECRET: "synthetic-only" }), /Unexpected injected demo environment key/);
});
test("unsafe database host overrides remain rejected before any DB import", () => {
  const changed = { ...valid, DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1/saydian_h5_demo?host=203.0.113.1" };
  replaceProfile(changed);
  rejectedBeforeSideEffect(execute("h5-demo-runtime.mjs", ["init-db", profilePath]), /Only dedicated loopback/);
  rejectedBeforeSideEffect(execute("seed-h5-demo.mjs", [], changed), /Only dedicated loopback/);
});
