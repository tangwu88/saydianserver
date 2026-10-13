import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

class ArtifactTransferError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function retryable(error) {
  return error instanceof TypeError || error?.name === "TimeoutError" ||
    error?.name === "AbortError" || error?.code === "range_truncated" ||
    error instanceof ArtifactTransferError && [403, 408, 429, 500, 502, 503, 504].includes(error.status);
}

function safeFailure(error) {
  return {
    code: error instanceof ArtifactTransferError ? error.code :
      error?.name === "AssertionError" ? "integrity_validation" :
      error?.name === "TimeoutError" ? "request_timeout" :
      error?.name === "AbortError" ? "request_aborted" : "network_or_io_failure",
    ...(error instanceof ArtifactTransferError && Number.isInteger(error.status) ? { status: error.status } : {}),
  };
}

async function artifactInfo(revision, artifactId, token, request, signal) {
  assert(/^[a-f0-9]{40}$/.test(revision) && /^[1-9][0-9]*$/.test(artifactId) && token);
  const endpoint = `https://api.github.com/repos/tangwu88/saydianserver/actions/artifacts/${artifactId}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
  };
  const metadataResponse = await request(endpoint, {
    headers,
    redirect: "manual",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  assert(metadataResponse.ok);
  const metadata = await metadataResponse.json();
  assert(metadata.name === `runtime-images-${revision}` && metadata.expired === false);
  assert(/^sha256:[a-f0-9]{64}$/.test(metadata.digest));
  assert(
    Number.isSafeInteger(metadata.size_in_bytes) &&
      metadata.size_in_bytes >= 8 * 1024 ** 2 &&
      metadata.size_in_bytes <= 2 * 1024 ** 3,
  );
  const location = async () => {
    const redirect = await request(`${endpoint}/zip`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (redirect.status !== 302) throw new ArtifactTransferError("redirect_status", redirect.status);
    const url = new URL(redirect.headers.get("location"));
    assert(url.protocol === "https:" && !url.username && !url.password);
    assert(/(?:\.blob\.core\.windows\.net|\.actions\.githubusercontent\.com)$/.test(url.hostname));
    return url.href;
  };
  return { metadata, location };
}

async function rangeBytes(request, location, from, to, total, signal) {
  // The GitHub token is never forwarded to signed storage URLs.
  const response = await request(location, {
    headers: { range: `bytes=${from}-${to}` },
    redirect: "manual",
    signal,
  });
  if (response.status !== 206) throw new ArtifactTransferError("range_status", response.status);
  assert(response.headers.get("content-range") === `bytes ${from}-${to}/${total}`);
  const size = to - from + 1;
  const contentLength = response.headers.get("content-length");
  assert(contentLength === null || contentLength === String(size));
  const bytes = new Uint8Array(size),
    reader = response.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      assert(offset + value.length <= size);
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== size) throw new ArtifactTransferError("range_truncated");
  } finally {
    await reader.cancel();
  }
  return bytes;
}

export async function probeArtifact(revision, artifactId, token, request = fetch) {
  const signal = AbortSignal.timeout(120000);
  const { metadata, location } = await artifactInfo(revision, artifactId, token, request, signal);
  const url = await location();
  const start = performance.now();
  const parts = await Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      const from = index * 1024 ** 2,
        to = from + 1024 ** 2 - 1;
      return rangeBytes(request, url, from, to, metadata.size_in_bytes, signal);
    }),
  );
  const seconds = (performance.now() - start) / 1000;
  const hash = createHash("sha256");
  for (const bytes of parts) hash.update(bytes);
  return {
    revision,
    artifactId,
    sampleBytes: 8 * 1024 ** 2,
    seconds: Number(seconds.toFixed(3)),
    MiBPerSecond: Number((8 / seconds).toFixed(3)),
    sampleSha256: hash.digest("hex"),
    imported: false,
  };
}

export async function downloadArtifact(
  revision,
  artifactId,
  token,
  outputPath,
  request = fetch,
  progress = () => {},
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3600000)]);
  const { metadata, location } = await artifactInfo(revision, artifactId, token, request, signal);
  const partSize = 1024 ** 2,
    count = Math.ceil(metadata.size_in_bytes / partSize);
  const scratch = await mkdtemp(join(dirname(outputPath), "https-parts-"));
  let cursor = 0,
    completed = 0,
    ownedOutput = false,
    output;
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, async () => {
        try {
          while (cursor < count) {
            const index = cursor++,
              from = index * partSize;
            // GitHub redirect URLs expire after a minute: renew for every new range.
            let bytes;
            for (let attempt = 0; attempt < 4; attempt++) {
              try {
                bytes = await rangeBytes(
                  request,
                  await location(),
                  from,
                  Math.min(from + partSize, metadata.size_in_bytes) - 1,
                  metadata.size_in_bytes,
                  AbortSignal.any([signal, AbortSignal.timeout(600000)]),
                );
                break;
              } catch (error) {
                if (signal.aborted || !retryable(error) || attempt === 3) throw error;
                progress({ event: "range_retry", rangeIndex: index, nextAttempt: attempt + 2, ...safeFailure(error) });
                await delay(1000 * (attempt + 1), undefined, { signal });
              }
            }
            await writeFile(join(scratch, String(index)), bytes, {
              flag: "wx",
              mode: 0o600,
            });
            completed += bytes.length;
            progress({
              downloadedBytes: completed,
              totalBytes: metadata.size_in_bytes,
            });
          }
        } catch (error) {
          controller.abort();
          throw error;
        }
      }),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    output = await open(outputPath, "wx", 0o600);
    ownedOutput = true;
    const hash = createHash("sha256");
    for (let index = 0; index < count; index++) {
      for await (const bytes of createReadStream(join(scratch, String(index)))) {
        hash.update(bytes);
        await output.writeFile(bytes);
      }
    }
    assert(`sha256:${hash.digest("hex")}` === metadata.digest);
    await output.sync();
    return {
      revision,
      artifactId,
      sizeBytes: completed,
      digest: metadata.digest,
      verified: true,
      imported: false,
    };
  } catch (error) {
    if (output) {
      await output.close();
      output = undefined;
    }
    if (ownedOutput) await rm(outputPath);
    throw error;
  } finally {
    if (output) await output.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = [process.env.PROBE_REVISION, process.env.PROBE_ARTIFACT_ID, process.env.GITHUB_TOKEN];
    const result =
      process.argv[2] === "download"
        ? await downloadArtifact(...args, "/downloads/runtime.zip", fetch, (event) =>
            console.log(JSON.stringify(event)),
          )
        : await probeArtifact(...args);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: "artifact_transfer_failed", ...safeFailure(error) }));
    console.error("HTTPS artifact verification failed; no images imported or applications changed.");
    process.exitCode = 1;
  }
}
