import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { probeArtifact, downloadArtifact } from "./runtime-artifact.mjs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const revision = "a".repeat(40),
  artifactId = "123",
  token = "fixture-secret";
const size = 1024 ** 2,
  total = 9 * size;
const metadata = {
  name: `runtime-images-${revision}`,
  expired: false,
  digest: `sha256:${"b".repeat(64)}`,
  size_in_bytes: total,
};

function fixture(options = {}) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    assert(init.signal instanceof AbortSignal);
    if (url.endsWith("/123"))
      return Response.json({ ...metadata, ...options.metadata }, { status: options.metadataStatus ?? 200 });
    if (url.endsWith("/zip"))
      return new Response(null, {
        status: options.redirectStatus ?? 302,
        headers: {
          location: options.location ?? "https://fixture.blob.core.windows.net/artifact?signature=private",
        },
      });
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.redirect, "manual");
    const [, from, to] = init.headers.range.match(/^bytes=(\d+)-(\d+)$/);
    const bytes = new Uint8Array(options.bodySize ?? Number(to) - Number(from) + 1).fill(Number(from) / size);
    return new Response(bytes, {
      status: options.rangeStatus ?? 206,
      headers: {
        "content-range": options.contentRange ?? `bytes ${from}-${to}/${total}`,
      },
    });
  };
  return { calls, request };
}

test("probe validates eight bounded HTTPS ranges without importing or leaking signed URLs", async () => {
  const { request, calls } = fixture();
  const result = await probeArtifact(revision, artifactId, token, request);
  assert.equal(result.sampleBytes, 8 * size);
  assert.equal(result.imported, false);
  assert(result.seconds >= 0 && result.MiBPerSecond > 0);
  const expected = createHash("sha256");
  for (let index = 0; index < 8; index++) expected.update(new Uint8Array(size).fill(index));
  assert.equal(result.sampleSha256, expected.digest("hex"));
  assert.equal(calls.length, 10);
  assert(calls.slice(0, 2).every(({ init }) => init.headers.authorization === `Bearer ${token}`));
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|signature=|https:/);
});

test("full HTTPS download verifies the whole archive digest and removes only its own temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "saydian-https-test-"));
  try {
    const archive = new Uint8Array(total);
    for (let from = 0; from < total; from += 4 * size)
      archive.fill(from / size, from, Math.min(from + 4 * size, total));
    const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    const progress = [],
      output = join(root, "runtime.zip");
    const result = await downloadArtifact(
      revision,
      artifactId,
      token,
      output,
      fixture({ metadata: { digest } }).request,
      (event) => progress.push(event),
    );
    assert.equal(result.digest, digest);
    assert.equal(result.verified, true);
    assert.equal(result.imported, false);
    assert.deepEqual(new Uint8Array(await readFile(output)), archive);
    assert.equal(progress.at(-1).downloadedBytes, total);
    assert.deepEqual(await readdir(root), ["runtime.zip"]);
    await assert.rejects(
      downloadArtifact(revision, artifactId, token, join(root, "corrupt.zip"), fixture().request),
    );
    assert.deepEqual(await readdir(root), ["runtime.zip"]);
    await writeFile(join(root, "original.zip"), "read-only source");
    await assert.rejects(
      downloadArtifact(
        revision,
        artifactId,
        token,
        join(root, "original.zip"),
        fixture({ metadata: { digest } }).request,
      ),
    );
    assert.equal(await readFile(join(root, "original.zip"), "utf8"), "read-only source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("probe rejects invalid revision, artifact ID or missing auth before any request", async () => {
  for (const args of [
    ["../bad", artifactId, token],
    [revision, "0", token],
    [revision, "123/x", token],
    [revision, artifactId, ""],
  ]) {
    const { request, calls } = fixture();
    await assert.rejects(probeArtifact(...args, request));
    assert.equal(calls.length, 0);
  }
});

test("download retries transient metadata and range failures without restarting completed ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "saydian-retry-test-"));
  try {
    const archive = new Uint8Array(total);
    for (let from = 0; from < total; from += 4 * size)
      archive.fill(from / size, from, Math.min(from + 4 * size, total));
    const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    const source = fixture({ metadata: { digest } });
    let metadataCalls = 0;
    const ranges = new Map(), progress = [], waits = [];
    const request = async (url, init) => {
      if (url.endsWith("/123") && metadataCalls++ === 0) throw new TypeError("temporary network error");
      if (init.headers.range) {
        const count = (ranges.get(init.headers.range) ?? 0) + 1;
        ranges.set(init.headers.range, count);
        if (init.headers.range.startsWith("bytes=0-")) {
          if (count === 1) throw new TypeError("temporary network error");
          if (count === 2) return new Response(new Uint8Array(2), {
            status: 206, headers: { "content-range": `bytes 0-${4 * size - 1}/${total}` },
          });
        }
      }
      return source.request(url, init);
    };
    const output = join(root, "runtime.zip");
    const result = await downloadArtifact(revision, artifactId, token, output, request,
      event => progress.push(event), async ms => { waits.push(ms); });
    assert.equal(result.verified, true);
    assert.deepEqual(new Uint8Array(await readFile(output)), archive);
    assert.equal(ranges.get(`bytes=0-${4 * size - 1}`), 3);
    assert.equal(ranges.get(`bytes=${4 * size}-${8 * size - 1}`), 1);
    assert.equal(ranges.get(`bytes=${8 * size}-${total - 1}`), 1);
    assert.equal(progress.filter(event => event.downloadRetry).length, 3);
    assert.deepEqual(waits.sort((a,b) => a-b), [1000,1000,2000]);
    assert.doesNotMatch(JSON.stringify(progress), /fixture-secret|signature=|https:/);
    assert.deepEqual(await readdir(root), ["runtime.zip"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("download exhausts bounded retries and still rejects invalid range responses without an output", async () => {
  const root = await mkdtemp(join(tmpdir(), "saydian-retry-bound-test-"));
  try {
    const source = fixture({ rangeStatus: 200 });
    await assert.rejects(downloadArtifact(revision, artifactId, token, join(root, "runtime.zip"),
      source.request, () => {}, async () => {}));
    const ranges = source.calls.filter(call => call.init.headers.range);
    assert.equal(ranges.length, 15);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("probe rejects missing, expired, misnamed or malformed artifact metadata", async () => {
  for (const options of [
    { metadataStatus: 404 },
    { metadata: { expired: true } },
    { metadata: { name: "wrong-release" } },
    { metadata: { digest: "invalid" } },
    { metadata: { size_in_bytes: 7 * size } },
    { metadata: { size_in_bytes: "9437184" } },
  ]) {
    const { request, calls } = fixture(options);
    await assert.rejects(probeArtifact(revision, artifactId, token, request));
    assert.equal(calls.length, 1);
  }
});

test("probe rejects HTTP, credentials, untrusted hosts and additional redirects", async () => {
  for (const options of [
    { redirectStatus: 200 },
    ...[
      "http://fixture.blob.core.windows.net/a",
      "https://user:pass@fixture.blob.core.windows.net/a",
      "https://blob.core.windows.net.evil.test/a",
      "https://evil.test/a",
    ].map((location) => ({ location })),
  ]) {
    const { request, calls } = fixture(options);
    await assert.rejects(probeArtifact(revision, artifactId, token, request));
    assert.equal(calls.length, 2);
  }
});

test("probe rejects wrong status, ranges, short and oversized samples", async () => {
  for (const options of [
    { rangeStatus: 302 },
    { rangeStatus: 200 },
    { contentRange: `bytes 0-${size - 1}/*` },
    { bodySize: size - 1 },
    { bodySize: size + 1 },
  ]) {
    await assert.rejects(probeArtifact(revision, artifactId, token, fixture(options).request));
  }
});

test("probe propagates aborted network requests and never falls back to a write operation", async () => {
  await assert.rejects(
    probeArtifact(revision, artifactId, token, async () => {
      throw new DOMException("aborted", "AbortError");
    }),
    { name: "AbortError" },
  );
});
