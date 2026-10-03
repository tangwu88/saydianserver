import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { probeArtifact } from './probe-runtime-artifact.mjs';

const revision = 'a'.repeat(40), artifactId = '123', token = 'fixture-secret';
const size = 1024 ** 2, total = 9 * size;
const metadata = { name: `runtime-images-${revision}`, expired: false, digest: `sha256:${'b'.repeat(64)}`, size_in_bytes: total };

function fixture(options = {}) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    assert(init.signal instanceof AbortSignal);
    if (url.endsWith('/123')) return Response.json({ ...metadata, ...options.metadata }, { status: options.metadataStatus ?? 200 });
    if (url.endsWith('/zip')) return new Response(null, { status: options.redirectStatus ?? 302, headers: { location: options.location ?? 'https://fixture.blob.core.windows.net/artifact?signature=private' } });
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.redirect, 'manual');
    const [, from, to] = init.headers.range.match(/^bytes=(\d+)-(\d+)$/);
    const bytes = new Uint8Array(options.bodySize ?? size).fill(Number(from) / size);
    return new Response(bytes, { status: options.rangeStatus ?? 206, headers: { 'content-range': options.contentRange ?? `bytes ${from}-${to}/${total}` } });
  };
  return { calls, request };
}

test('probe validates eight bounded HTTPS ranges without importing or leaking signed URLs', async () => {
  const { request, calls } = fixture();
  const result = await probeArtifact(revision, artifactId, token, request);
  assert.equal(result.sampleBytes, 8 * size);
  assert.equal(result.imported, false);
  assert(result.seconds >= 0 && result.MiBPerSecond > 0);
  const expected = createHash('sha256');
  for (let index = 0; index < 8; index++) expected.update(new Uint8Array(size).fill(index));
  assert.equal(result.sampleSha256, expected.digest('hex'));
  assert.equal(calls.length, 10);
  assert(calls.slice(0, 2).every(({ init }) => init.headers.authorization === `Bearer ${token}`));
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|signature=|https:/);
});

test('probe rejects invalid revision, artifact ID or missing auth before any request', async () => {
  for (const args of [['../bad', artifactId, token], [revision, '0', token], [revision, '123/x', token], [revision, artifactId, '']]) {
    const { request, calls } = fixture();
    await assert.rejects(probeArtifact(...args, request));
    assert.equal(calls.length, 0);
  }
});

test('probe rejects missing, expired, misnamed or malformed artifact metadata', async () => {
  for (const options of [{ metadataStatus: 404 }, { metadata: { expired: true } }, { metadata: { name: 'wrong-release' } }, { metadata: { digest: 'invalid' } }, { metadata: { size_in_bytes: 7 * size } }, { metadata: { size_in_bytes: '9437184' } }]) {
    const { request, calls } = fixture(options);
    await assert.rejects(probeArtifact(revision, artifactId, token, request));
    assert.equal(calls.length, 1);
  }
});

test('probe rejects HTTP, credentials, untrusted hosts and additional redirects', async () => {
  for (const options of [{ redirectStatus: 200 }, ...['http://fixture.blob.core.windows.net/a', 'https://user:pass@fixture.blob.core.windows.net/a', 'https://blob.core.windows.net.evil.test/a', 'https://evil.test/a'].map(location => ({ location }))]) {
    const { request, calls } = fixture(options);
    await assert.rejects(probeArtifact(revision, artifactId, token, request));
    assert.equal(calls.length, 2);
  }
});

test('probe rejects wrong status, ranges, short and oversized samples', async () => {
  for (const options of [{ rangeStatus: 302 }, { rangeStatus: 200 }, { contentRange: `bytes 0-${size - 1}/*` }, { bodySize: size - 1 }, { bodySize: size + 1 }]) {
    await assert.rejects(probeArtifact(revision, artifactId, token, fixture(options).request));
  }
});

test('probe propagates aborted network requests and never falls back to a write operation', async () => {
  await assert.rejects(probeArtifact(revision, artifactId, token, async () => { throw new DOMException('aborted', 'AbortError'); }), { name: 'AbortError' });
});
