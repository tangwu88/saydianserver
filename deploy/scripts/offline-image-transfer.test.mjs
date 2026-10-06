import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { shellPath, shellArgs, bashCommand, shellEnvironment, writeNodeDouble, writeWindowsInstallDouble } from "../../tools/shell-test-fixture.mjs";
import { validateTransfer } from "./offline-image-transfer.mjs";

const revision = "a".repeat(40), imageId = "sha256:" + "b".repeat(64);
const hash = value => createHash("sha256").update(value).digest("hex");
const chunks = [Buffer.from("first fixture chunk"), Buffer.from("second fixture chunk")];
const manifestText = JSON.stringify({ schemaVersion: 1, revision,
  images: Object.fromEntries(["api", "worker", "admin"].map(name => [name, { ref: `ghcr.io/tangwu88/saydianserver-${name}@sha256:${"c".repeat(64)}`, imageId, sizeBytes: 4096 }])),
  migrations: [{ name: "20261001190000_say_ring_legal_product", sha256: "d".repeat(64), automatic: true }] });
const descriptor = () => ({ schemaVersion: 1, revision, manifestSha256: hash(manifestText), archive: { sha256: hash(Buffer.concat(chunks)), sizeBytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0) }, chunks: chunks.map((chunk, index) => ({ name: `chunk-00${index}`, sizeBytes: chunk.length, sha256: hash(chunk) })) });
test("offline metadata binds every bounded chunk to the original immutable release", () => {
  validateTransfer(descriptor(), manifestText, revision);
  for (const mutate of [value => { value.revision = "e".repeat(40); }, value => { value.manifestSha256 = "f".repeat(64); }, value => { value.chunks[0].name = "../other"; }, value => { value.chunks[0].sizeBytes = 9 * 1024 ** 2; }, value => { value.archive.sizeBytes++; }]) {
    const value = descriptor(); mutate(value); assert.throws(() => validateTransfer(value, manifestText, revision));
  }
});

function fixture(mode, callback) {
  const root = mkdtempSync(join(tmpdir(), "saydian-offline-test-"));
  try {
    const source = join(root, "releases/ci-fixture"), payload = join(source, "deploy"), bin = join(root, "bin");
    mkdirSync(payload, { recursive: true }); mkdirSync(bin);
    writeFileSync(join(payload, "release-manifest.json"), manifestText);
    writeFileSync(join(payload, "offline-transfer.json"), JSON.stringify(descriptor()));
    writeFileSync(join(payload, "unrelated-file"), "preserve");
    const script = join(root, "receiver.sh");
    writeFileSync(script, readFileSync(new URL("./receive-offline-images.sh", import.meta.url), "utf8").replaceAll("/opt/saydianapp-server", shellPath(root)));
    const double = `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process');
const tool=path.basename(process.argv[1]), a=process.argv.slice(2), root=process.env.FIXTURE_ROOT;
if(tool==='readlink') console.log(process.env.FIXTURE_SHELL_ROOT+'/deploy/.ci-release.lock');
if(tool==='df') console.log('Filesystem 1B-blocks Used Available Capacity Mounted\\nfixture 100000000000 0 '+(process.env.FIXTURE_MODE==='disk-full'?1:100000000000)+' 0% /');
if(tool==='docker') {
 fs.appendFileSync(root+'/calls.log',a.join(' ')+'\\n');
 if(a[0]==='inspect') console.log('${imageId}');
 if(a[0]==='run') {
  const args=a.slice(a.indexOf('/release/scripts/offline-image-transfer.mjs')+1).map(value=>value.startsWith('/release/')?process.env.RELEASE_SOURCE+'/deploy/'+value.slice(9):value);
  const result=cp.spawnSync(process.execPath,[process.env.FIXTURE_HELPER,...args],{stdio:'inherit'}); process.exit(result.status??1);
 }
 if(a[0]==='image') { if(!fs.existsSync(root+'/loaded')) process.exit(1); console.log('${imageId} '+(process.env.FIXTURE_MODE==='wrong-image'?'f'.repeat(40):'${revision}')); }
 if(a[0]==='load') fs.writeFileSync(root+'/loaded','1');
}
`;
    for (const name of ["docker", "readlink", "flock", "df"]) writeNodeDouble(bin, name, double);
    writeWindowsInstallDouble(bin);
    const receive = (index, corrupt = false) => {
      writeFileSync(join(payload, "chunk-name"), `chunk-00${index}\n`);
      writeFileSync(join(payload, "image-chunk"), corrupt ? Buffer.from("corrupt") : chunks[index]);
      writeFileSync(join(source, "bundle.tgz"), "owned receiver fixture");
      const result = spawnSync(bashCommand, shellArgs(bin, script), { encoding: "utf8", timeout: 15000, env: shellEnvironment(bin, { RELEASE_SOURCE: shellPath(source), FIXTURE_NATIVE_SOURCE: source, RELEASE_SHA: revision, FIXTURE_ROOT: root, FIXTURE_SHELL_ROOT: shellPath(root), FIXTURE_MODE: mode, FIXTURE_HELPER: fileURLToPath(new URL("./offline-image-transfer.mjs", import.meta.url)) }) });
      return { ...result, output: result.stdout + result.stderr };
    };
    callback({ receive, loaded: () => existsSync(join(root, "loaded")), calls: () => existsSync(join(root, "calls.log")) ? readFileSync(join(root, "calls.log"), "utf8") : "",
      retained: () => readdirSync(join(root, "deploy/unified/offline", revision, descriptor().archive.sha256)).sort(),
      incoming: () => existsSync(join(payload, "image-chunk")) || existsSync(join(source, "bundle.tgz")),
      unrelated: () => readFileSync(join(payload, "unrelated-file"), "utf8") });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("imports only after every chunk verifies; resumes out of order without restarting apps", () => fixture("success", ({ receive, loaded, calls, retained, incoming, unrelated }) => {
  let result = receive(1); assert.equal(result.status, 0, result.output); assert(!loaded());
  result = receive(0); assert.equal(result.status, 0, result.output); assert(loaded());
  result = receive(1); assert.equal(result.status, 0, result.output);
  assert.equal(calls().split("\n").filter(line => line.startsWith("load ")).length, 1);
  assert(!/compose|migrate|prune|build|restart/.test(calls()));
  assert.deepEqual(retained(), ["imported", "offline-transfer.json", "release-manifest.json"]);
  assert(!incoming()); assert.equal(unrelated(), "preserve");
}));
test("rejects corrupt chunks and insufficient space before loading", () => {
  fixture("success", ({ receive, loaded }) => { assert.notEqual(receive(0, true).status, 0); assert(!loaded()); });
  fixture("disk-full", ({ receive, loaded }) => { const result = receive(0); assert.notEqual(result.status, 0, result.output); assert(!loaded()); });
});
test("does not accept an image with the wrong revision after import", () => fixture("wrong-image", ({ receive }) => {
  assert.equal(receive(0).status, 0); assert.notEqual(receive(1).status, 0);
}));
