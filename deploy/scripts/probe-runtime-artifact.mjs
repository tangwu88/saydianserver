import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function probeArtifact(revision, artifactId, token, request = fetch) {
  assert(/^[a-f0-9]{40}$/.test(revision) && /^[1-9][0-9]*$/.test(artifactId) && token);
  const endpoint = `https://api.github.com/repos/tangwu88/saydianserver/actions/artifacts/${artifactId}`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
  const metadataResponse = await request(endpoint, { headers, signal: AbortSignal.timeout(15000) });
  assert(metadataResponse.ok);
  const metadata = await metadataResponse.json();
  assert(metadata.name === `runtime-images-${revision}` && !metadata.expired);
  assert(/^sha256:[a-f0-9]{64}$/.test(metadata.digest));
  assert(Number.isSafeInteger(metadata.size_in_bytes) && metadata.size_in_bytes >= 8 * 1024 ** 2);
  const redirect = await request(`${endpoint}/zip`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert(redirect.status === 302);
  const location = new URL(redirect.headers.get('location'));
  assert(location.protocol === 'https:' && !location.username && !location.password);
  assert(/(?:\.blob\.core\.windows\.net|\.actions\.githubusercontent\.com)$/.test(location.hostname));
  const start = performance.now();
  const parts = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const from = index * 1024 ** 2, to = from + 1024 ** 2 - 1;
    // Do not forward the GitHub token to the signed storage URL or follow another redirect.
    const response = await request(location.href, { headers: { range: `bytes=${from}-${to}` }, redirect: 'manual', signal: AbortSignal.timeout(120000) });
    assert(response.status === 206 && response.headers.get('content-range') === `bytes ${from}-${to}/${metadata.size_in_bytes}`);
    const size = 1024 ** 2;
    const contentLength = response.headers.get('content-length');
    assert(contentLength === null || contentLength === String(size));
    const bytes = new Uint8Array(size);
    const reader = response.body.getReader();
    let offset = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        assert(offset + value.length <= size);
        bytes.set(value, offset);
        offset += value.length;
      }
      assert(offset === size);
    } finally {
      await reader.cancel();
    }
    return bytes;
  }));
  const seconds = (performance.now() - start) / 1000;
  const hash = createHash('sha256');
  for (const bytes of parts) hash.update(bytes);
  return { revision, artifactId, sampleBytes: 8 * 1024 ** 2, seconds: Number(seconds.toFixed(3)), MiBPerSecond: Number((8 / seconds).toFixed(3)), sampleSha256: hash.digest('hex'), imported: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await probeArtifact(process.env.PROBE_REVISION, process.env.PROBE_ARTIFACT_ID, process.env.GITHUB_TOKEN)));
  } catch {
    console.error('HTTPS artifact probe failed; no images imported or applications changed.');
    process.exitCode = 1;
  }
}
