import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareUnifiedCompose, validateComposeSources } from "./prepare-unified-compose.mjs";
import { unifyGateway, freezeGateway, cutoverCallbackPattern } from "./unify-gateway.mjs";
import { missingSettings } from "./import-missing-settings.mjs";
import { verifyCutoverData } from "./verify-cutover-data.mjs";
import { preflight } from "./unified-preflight.mjs";

test("first-cutover retry only trusts the verified rollback snapshot of the running image", () => {
  const original = `/opt/saydian-global/releases/${"a".repeat(40)}/deploy/global/compose.json`;
  validateComposeSources(original, "image", () => { throw Error("unexpected read"); });
  validateComposeSources(original + ",/opt/saydian-global/private/payment-live.override.json", "image");
  assert.throws(() => validateComposeSources(original + ",/tmp/unreviewed.json", "image"));
  const directory = `/opt/saydianapp-server/deploy/unified/backups/20261001T183956Z-${"a".repeat(12)}-123`;
  const files = `${directory}/global-live.json,${directory}/images.json`;
  const evidence = file => file.endsWith("/images.json") ? { services: { "global-api": { image: "image" } } } : { verified: true };
  validateComposeSources(files, "image", evidence);
  assert.throws(() => validateComposeSources(files, "different-image", evidence));
  assert.throws(() => validateComposeSources(files, "image", () => ({ verified: false })));
  assert.throws(() => validateComposeSources(files.replace("/images.json", "/../images.json"), "image", evidence));
  assert.throws(() => validateComposeSources(files + ",/tmp/override.json", "image", evidence));
});

test("disk gate reserves image, restore, backup and 5 GiB; first cutover is never implicit", () => {
  const manifest = { images: { api: { sizeBytes: 100 }, worker: { sizeBytes: 200 }, admin: { sizeBytes: 300 } }, migrations: [] };
  const state = { schemaVersion: 1, cutoverCompleted: true, databaseContainer: "saydian-global-global-postgres-1", restoreBytes: 1000, backupBytes: 2000 };
  const required = 3600 + 5 * 1024 ** 3;
  assert.equal(preflight(manifest, state, [], required).requiredBytes, required);
  assert.throws(() => preflight(manifest, state, [], required - 1), /Insufficient/);
  state.cutoverCompleted = false;
  assert.throws(() => preflight(manifest, state, [], required), /not been accepted/);
  assert.equal(preflight(manifest, state, [], required, true).requiredBytes, required);
});

function config() {
  const environment = { DATABASE_URL: "postgresql://global_app:synthetic@global-postgres:5432/saydian_global", AUTH_ISSUER: "saydian-global-server", AUTH_AUDIENCE: "saydian-global-app", ACCESS_TOKEN_SECRET: "synthetic-access", REFRESH_TOKEN_PEPPER: "synthetic-refresh", FIELD_ENCRYPTION_KEY: "synthetic-field", INTEGRATION_MASTER_KEY: "synthetic-integration", APP_REALM: "global", PUBLIC_BASE_URL: "https://app.saydian.cn/global", MAINTENANCE_READ_ONLY: "true", WORKER_OUTBOUND_PAUSED: "true", SMS_PROVIDER: "disabled" };
  return { name: "saydian-global", services: { "global-api": { environment, networks: { gateway: { aliases: ["global-api"] } }, volumes: [{ type: "volume", source: "existing-avatar", target: "/avatars" }] }, "global-worker": { environment: { ...environment }, networks: ["private"] }, "global-admin": { read_only: true }, "global-postgres": { volumes: ["original-database:/data"] } }, volumes: { "original-database": { name: "saydian-global_global_postgres_data" } }, networks: { private: { internal: true }, gateway: { external: true } } };
}
test("cutover preserves exact databases, volumes, encryption/signing secrets and closed capabilities", () => {
  const before = config(), result = prepareUnifiedCompose(before);
  for (const key of ["volumes", "networks"]) assert.deepEqual(result[key], before[key]);
  assert.deepEqual(result.services["global-postgres"], before.services["global-postgres"]);
  for (const name of ["global-api", "global-worker"]) {
    const original = before.services[name].environment, environment = result.services[name].environment;
    for (const [key, value] of Object.entries(original)) if (!["APP_REALM", "PUBLIC_BASE_URL"].includes(key)) assert.equal(environment[key], value);
    assert.equal(environment.APP_REALM, undefined);
    assert.equal(environment.PUBLIC_BASE_URL, "https://app.saydian.cn");
    assert.deepEqual(result.services[name].command, ["node", "dist/main.js"]);
  }
  assert.equal(result.services["global-admin"].volumes[0].read_only, true);
  assert.equal(before.services["global-api"].environment.APP_REALM, "global", "source snapshot is immutable");
  for (const mutate of [c => c.name = "other", c => c.services["global-api"].environment.AUTH_ISSUER = "other", c => c.services["global-worker"].environment.DATABASE_URL = "postgresql://wrong/db"]) {
    const value = config(); mutate(value); assert.throws(() => prepareUnifiedCompose(value));
  }
});
test("gateway aliases preserve request URI/method and unrelated hosts byte for byte", () => {
  const template = readFileSync(new URL("../nginx/app-https.conf.template", import.meta.url), "utf8").replaceAll("__APP_DOMAIN__", "app.saydian.cn");
  const routes = readFileSync(new URL("../global/nginx.locations.conf", import.meta.url), "utf8");
  const before = "# untouched other host\n" + template.replace("__SAYDIAN_GLOBAL_ROUTES__", routes) + "\n# untouched suffix";
  const result = unifyGateway(before);
  assert(result.startsWith("# untouched other host\n") && result.endsWith("\n# untouched suffix"));
  assert(result.includes("proxy_pass http://unified-api:8080;"));
  assert(!result.includes("http://global-api:8080/api/"));
  assert(!/location = \/global\/api\s*\{\s*return/.test(result));
  assert(result.includes("location ^~ /global/wechat/sayring/"));
  assert.equal(unifyGateway(result), result);
  assert.throws(() => unifyGateway(before + template));
  const frozen = freezeGateway(result);
  assert(frozen.includes('if ($uri ~* "^/(global/)?api(/|$)")'));
  assert(frozen.includes('if ($saydian_cutover_block = 1) { return 503; }'));
  assert(frozen.startsWith("# untouched other host\n") && frozen.endsWith("\n# untouched suffix"));
  assert.throws(() => freezeGateway(frozen));
  const callbacks = [...readFileSync(new URL("../../packages/contracts/src/cutover.ts", import.meta.url), "utf8").matchAll(/"(\/api\/[^"\n]+)"/g)].map(match => match[1]);
  assert.equal(callbacks.length, 7);
  const allowed = new RegExp(cutoverCallbackPattern);
  for (const path of callbacks) { assert(allowed.test(path)); assert(allowed.test('/global' + path)); }
  for (const path of ['/api/v1/member/member/my', '/global/api/saydian-app/v2/devices', callbacks[0] + '/nested', '/untrusted' + callbacks[0]]) assert(!allowed.test(path));
});
test("settings import only fills missing download/support values; no permissions or provider enablement", () => {
  const source = [{ key: "app_update", value: { name: "a'b" }, public: true, updatedAt: "2026-10-01T00:00:00Z" }, { key: "support", value: {}, public: true, updatedAt: "2026-10-01T00:00:00Z" }];
  const retained = { ...source[0], value: { version: "current" } };
  const result = missingSettings(source, [retained]);
  assert.deepEqual(result.audit.inserted, ["support"]);
  assert.deepEqual(result.audit.retained[0].retained, retained);
  assert(!result.sql.includes("app_update"));
  assert(result.sql.includes("ON CONFLICT (key) DO NOTHING"));
  assert(missingSettings([source[0]], []).sql.includes("a''b"));
  assert.throws(() => missingSettings([{ ...source[0], key: "integration" }], []));
});
test("data acceptance catches lost members, changed money, roles or provider state", () => {
  const before = [...Array.from({ length: 45 }, (_, index) => ({ table: `table${index}`, count: 1, digest: "unchanged" })), { table: "ProviderEvent", count: 1, digest: "one" }, { invalidConstraints: 0 }];
  verifyCutoverData(before, before);
  const changed = structuredClone(before); changed[0].digest = "changed";
  assert.throws(() => verifyCutoverData(before, changed), /Unexpected cutover data/);
  const callbacks = structuredClone(before); callbacks[45] = { table: "ProviderEvent", count: 2, digest: "new receipt" };
  verifyCutoverData(before, callbacks);
  callbacks[45].count = 0; assert.throws(() => verifyCutoverData(before, callbacks), /lost/);
});
