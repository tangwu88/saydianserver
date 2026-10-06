import assert from "node:assert/strict";
import test from "node:test";
import { inputHash, reuseDockerfile } from "./component-cache.mjs";

const entries = [
  ["pnpm-lock.yaml", Buffer.from("lock")],
  ["apps/api/src/main.ts", Buffer.from("api")],
  ["apps/api/prisma/schema.prisma", Buffer.from("schema")],
  ["apps/admin-web/src/main.ts", Buffer.from("admin")],
];
test("frontend-only changes preserve backend inputs, while contracts and schema invalidate consumers", () => {
  const changed = entries.map(([path, bytes]) => [path, path.includes("admin-web") ? Buffer.from("new") : bytes]);
  assert.equal(inputHash("api", entries), inputHash("api", changed));
  assert.equal(inputHash("worker", entries), inputHash("worker", changed));
  assert.notEqual(inputHash("admin", entries), inputHash("admin", changed));
  for (const name of ["api", "worker", "admin"]) {
    assert.notEqual(inputHash(name, entries), inputHash(name, [...entries, ["packages/contracts/src/new.ts", Buffer.from("contract")]]));
    assert.notEqual(inputHash(name, entries), inputHash(name, entries.filter(([path]) => path !== "pnpm-lock.yaml")));
  }
  const schema = entries.map(([path, bytes]) => [path, path.endsWith("schema.prisma") ? Buffer.from("new") : bytes]);
  assert.notEqual(inputHash("worker", entries), inputHash("worker", schema));
});
test("cache ignores documentation but invalidates names, content, deletions and build rules", () => {
  assert.equal(inputHash("api", entries), inputHash("api", [...entries, ["docs/note.md", Buffer.from("note")]]));
  assert.notEqual(inputHash("api", entries), inputHash("api", entries.filter(([path]) => !path.endsWith("main.ts"))));
  assert.notEqual(inputHash("api", entries), inputHash("api", [...entries, ["docker/api.Dockerfile", Buffer.from("new")]]));
  assert.equal(inputHash("api", entries), inputHash("api", [...entries].reverse()));
});
test("reuse keeps digest-pinned files and rejects wrong fingerprint, repository, platform and revision", () => {
  const hash = "b".repeat(64), revision = "a".repeat(40);
  const image = { Id: `sha256:${"d".repeat(64)}`, Os: "linux", Architecture: "amd64", Config: { Labels: { "cc.saydian.build-input": hash, "org.opencontainers.image.revision": "c".repeat(40) } }, RepoDigests: [`ghcr.io/tangwu88/saydianserver-api@sha256:${"d".repeat(64)}`] };
  assert.match(reuseDockerfile("api", image, hash, revision), /^FROM .*@sha256:[a-f0-9]{64}\nLABEL/);
  assert.throws(() => reuseDockerfile("api", image, "f".repeat(64), revision));
  assert.throws(() => reuseDockerfile("worker", image, hash, revision));
  assert.throws(() => reuseDockerfile("api", { ...image, Architecture: "arm64" }, hash, revision));
  assert.throws(() => reuseDockerfile("api", { ...image, Id: `sha256:${"e".repeat(64)}` }, hash, revision));
  assert.throws(() => reuseDockerfile("api", image, hash, "latest"));
});
