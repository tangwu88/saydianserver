import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./ci-registry-login.sh", import.meta.url));

function run(files) {
  const root = mkdtempSync(join(tmpdir(), "saydian-registry-login-"));
  try {
    const payload = join(root, "deploy");
    const bin = join(root, "bin");
    mkdirSync(payload);
    mkdirSync(bin);
    const calls = join(root, "docker-calls.log");
    writeFileSync(join(bin, "docker"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\n`, { mode: 0o755 });
    for (const file of files) writeFileSync(join(payload, file), "verified fixture");
    const result = spawnSync("bash", [script, payload], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_TOKEN: "test-token", DOCKER_CALLS: calls },
    });
    return {
      ...result,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      calls: existsSync(calls) ? readFileSync(calls, "utf8") : "",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("offline image chunks bypass the slow registry login", () => {
  const result = run(["chunk-name", "image-chunk", "offline-transfer.json", "release-manifest.json"]);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.calls, "");
});

test("normal deployment bundles still log in to GHCR", () => {
  const result = run(["release-manifest.json"]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.calls, /^login ghcr\.io -u tangwu88 --password-stdin\n$/);
});
