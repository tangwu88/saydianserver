import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { shellPath, shellArgs, bashCommand, shellEnvironment, writeNodeDouble, writeWindowsInstallDouble } from "../../tools/shell-test-fixture.mjs";

// Execute the real routine publisher with isolated command doubles. No daemon,
// database, network, credentials or production path is used by these tests.
const revision = "a".repeat(40), imageId = "sha256:" + "b".repeat(64);
function run(mode) {
  const root = mkdtempSync(join(tmpdir(), "saydian-deploy-test-"));
  try {
    const source = join(root, "releases/ci-fixture"), state = join(root, "deploy/unified"), bin = join(root, "bin"), gateway = join(root, "gateway-nginx.conf");
    for (const directory of [join(source, "deploy"), state, bin]) mkdirSync(directory, { recursive: true });
    if (!["not-initialized", "legacy-active"].includes(mode)) writeFileSync(join(state, "accepted.json"), "{}");
    if (mode === "legacy-active") writeFileSync(join(source, "deploy/.first-unified-cutover"), "");
    writeFileSync(join(state, "compose.json"), '{"name":"saydian-global","services":{}}');
    writeFileSync(gateway, "# synthetic shared gateway\n");
    const manifest = { schemaVersion: 1, revision, migrations: [{ name: "20261001190000_say_ring_legal_product", sha256: "c".repeat(64), automatic: true }], images: Object.fromEntries(["api", "worker", "admin"].map(name => [name, { ref: `ghcr.io/tangwu88/saydianserver-${name}@sha256:${"d".repeat(64)}`, imageId, sizeBytes: 10 }])) };
    writeFileSync(join(source, "deploy/release-manifest.json"), JSON.stringify(manifest));
    const publisher = readFileSync(new URL("./deploy-unified.sh", import.meta.url), "utf8").replaceAll("/opt/saydianapp-server", shellPath(root));
    const script = join(root, "publisher.sh"); writeFileSync(script, publisher);
    const double = `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path');
const tool=path.basename(process.argv[1]), a=process.argv.slice(2), mode=process.env.FIXTURE_MODE;
fs.appendFileSync(process.env.FIXTURE_LOG, tool+' '+a.join(' ')+'\\n');
const revision='${revision}', imageId='${imageId}';
if(tool==='readlink') console.log(process.env.FIXTURE_SHELL_ROOT+'/deploy/.ci-release.lock');
if(tool==='timeout') { const r=require('node:child_process').spawnSync(process.execPath,[path.join(process.env.FIXTURE_BIN,a[3]+'.cjs'),...a.slice(4)],{stdio:'inherit'});process.exit(r.status??1); }
if(tool==='curl') {
 const url=a.at(-1);
 let publicRevision=revision;
 if(/health/.test(url)) {
  const marker=process.env.FIXTURE_ROOT+'/public-probe';
  if(mode==='public-stale'||mode==='public-stale-once'&&!fs.existsSync(marker)) publicRevision='f'.repeat(40);
  fs.writeFileSync(marker,'1');
 }
 const page=url.includes('/say-ring/privacy')?'<html>Say Ring 隐私政策</html>':url.includes('/say-ring/terms')?'<html>Say Ring 用户协议</html>':'<html>tested page</html>';
 console.log(url.includes('api.github.com') ? JSON.stringify({object:{sha:mode==='stale'?'f'.repeat(40):revision}}) : /health/.test(url)?JSON.stringify({status:'ready',revision:publicRevision}):page);
}
if(tool==='docker') {
 if(a[0]==='pull') { if(mode==='pull-failed') process.exit(1); fs.writeFileSync(process.env.FIXTURE_ROOT+'/pulled','1'); process.exit(0); }
 if(a[0]==='image') { if(a.includes('{{.Id}}') && mode!=='cached' && !fs.existsSync(process.env.FIXTURE_ROOT+'/pulled')) process.exit(1); console.log(a.includes('{{.Id}}')?imageId:revision); }
 else if(a[0]==='inspect') console.log(a.join(' ').includes('.Config.Env')?'["POSTGRES_USER=global_owner","POSTGRES_DB=saydian_global","POSTGRES_PASSWORD=synthetic-test-only"]':a.join(' ').includes('.Image')?(fs.existsSync(process.env.FIXTURE_ROOT+'/changed')?imageId:'sha256:'+'e'.repeat(64)):imageId);
 else if(a[0]==='run') {
  const helper=a.find(v=>v.startsWith('/release/scripts/'));
  if(helper?.endsWith('unify-gateway.mjs')) fs.copyFileSync(process.env.RELEASE_SOURCE+'/gateway.conf',process.env.RELEASE_SOURCE+'/gateway-candidate.conf');
  if(helper?.endsWith('release-manifest.mjs') && a.includes('compose')) console.log(JSON.stringify({services:{'global-api':{image:imageId}}}));
 } else if(a[0]==='exec') {
  const input=fs.readFileSync(0,'utf8');
  if(a.join(' ').includes('psql')) console.log('[]');
  else if(a.join(' ').includes('pg_dump')) console.log('synthetic archive');
  else if(a.includes('wget')) { if(mode==='health-failed') process.exit(1);console.log(JSON.stringify({status:'ready',revision})); }
 } else if(a[0]==='compose') {
  if(a.includes('deploy') && mode==='migration-failed') process.exit(1);
  if(a.includes('up')) { fs.writeFileSync(process.env.FIXTURE_ROOT+'/changed','1');if(mode==='start-failed'&&!a.some(v=>v.includes('/backups/')))process.exit(1); }
 }
}
`;
    for (const name of ["docker", "curl", "timeout", "sleep", "readlink", "flock", "sha256sum", "systemctl"]) writeNodeDouble(bin, name, double);
    writeWindowsInstallDouble(bin);
    const log = join(root, "calls.log");
    const result = spawnSync(bashCommand, shellArgs(bin, script), { encoding: "utf8", timeout: 30_000, env: shellEnvironment(bin, { RELEASE_SHA: revision, RELEASE_SOURCE: shellPath(source), FIXTURE_NATIVE_SOURCE: source, GATEWAY_CONFIG_PATH: shellPath(gateway), GITHUB_TOKEN: "synthetic-job-token", FIXTURE_MODE: mode, FIXTURE_LOG: log, FIXTURE_ROOT: root, FIXTURE_SHELL_ROOT: shellPath(root), FIXTURE_BIN: bin }) });
    return { status: result.status, output: result.stdout + result.stderr, calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("ordinary publication cannot perform an implicit first cutover", () => {
  const result = run("not-initialized"); assert.notEqual(result.status, 0); assert(!result.calls.includes("docker"));
});
test("first cutover refuses an active legacy publisher before reading or changing Compose", () => {
  const result = run("legacy-active"); assert.notEqual(result.status, 0);
  assert.match(result.output, /Legacy publisher is active/);
  assert(!result.calls.includes("docker compose"));
});
test("pull failure or superseded SHA leaves the existing services and schema unchanged", () => {
  for (const mode of ["pull-failed", "stale"]) {
    const result = run(mode); assert.notEqual(result.status, 0, result.output);
    assert(!result.calls.includes("migrate deploy")); assert(!result.calls.includes(" up "));
  }
});
test("migration failure never restarts apps; startup or health failure rolls back only pinned images", () => {
  const migration = run("migration-failed"); assert.notEqual(migration.status, 0); assert(!migration.calls.includes(" up "));
  for (const mode of ["start-failed", "health-failed"]) {
    const result = run(mode); assert.notEqual(result.status, 0, result.output);
    assert.match(result.calls, /backups\/[^\n]+images.json up -d --no-build --pull never/);
    assert(!result.calls.includes("pg_restore --clean"));
  }
});
test("successful routine publication verifies both health aliases without build, seed or cleanup", () => {
  const result = run("success"); assert.equal(result.status, 0, result.output);
  assert(result.calls.includes("https://app.saydian.cn/global/health/ready"));
  for (const path of ["/down2", "/down2/", "/down/legacy", "/global/down", "/global/down/"])
    assert(result.calls.includes(`https://app.saydian.cn${path}`));
  assert(!/docker build|prisma db seed|compose down|docker prune/.test(result.calls));
});
test("an exact locally cached image skips registry transfer but still verifies the release", () => {
  const result = run("cached"); assert.equal(result.status, 0, result.output);
  assert(!result.calls.includes("docker pull "));
  assert.match(result.output, /already verified locally/);
  assert(result.calls.includes("org.opencontainers.image.revision"));
  assert(result.calls.includes("https://app.saydian.cn/global/health/ready"));
});
test("public readiness tolerates a reloading gateway but rejects persistent old revisions", () => {
  const recovered = run("public-stale-once"); assert.equal(recovered.status, 0, recovered.output);
  const failed = run("public-stale"); assert.notEqual(failed.status, 0, failed.output);
  assert.match(failed.output, /Public readiness failed: \/health\/ready/);
  assert.match(failed.output, /Release check failed at deploy-unified.sh:\d+ \(exit 1\)/);
  assert.match(failed.calls, /backups\/[^\n]+images.json up -d --no-build --pull never/);
});
