import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const components = ["api", "worker", "admin"];
const repository = "ghcr.io/tangwu88/saydianserver";
const common = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", ".dockerignore", ".npmrc", ".pnpmfile.cjs"];

export function isComponentInput(name, path) {
  assert(components.includes(name));
  if (common.includes(path) || path.startsWith("packages/contracts/") || path.startsWith(".github/") || path.startsWith("deploy/scripts/")) return true;
  if (path === `docker/${name}.Dockerfile`) return true;
  if (name === "api") return path.startsWith("packages/commerce-domain/") || path.startsWith("apps/api/");
  if (name === "worker") return path.startsWith("packages/commerce-domain/") || path.startsWith("apps/worker/") || path.startsWith("apps/api/prisma/") || path === "apps/api/package.json";
  return ["apps/admin-web/", "apps/download-web/", "apps/shop/"].some(prefix => path.startsWith(prefix)) || path === "docker/admin-nginx.conf";
}

export function inputHash(name, entries) {
  const hash = createHash("sha256").update(`saydian-component-v1:${name}\0`);
  for (const [path, bytes] of entries.filter(([path]) => isComponentInput(name, path)).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path).update("\0").update(createHash("sha256").update(bytes).digest()).update("\0");
  }
  return hash.digest("hex");
}

export function reuseDockerfile(name, image, hash, revision) {
  assert(components.includes(name) && /^[a-f0-9]{64}$/.test(hash) && /^[a-f0-9]{40}$/.test(revision));
  assert(image?.Config?.Labels?.["cc.saydian.build-input"] === hash, "Cached input fingerprint differs");
  assert(/^[a-f0-9]{40}$/.test(image.Config.Labels["org.opencontainers.image.revision"] ?? ""), "Cached build revision missing");
  const ref = image.RepoDigests?.find(value => new RegExp(`^${repository}-${name}@sha256:[a-f0-9]{64}$`).test(value));
  assert(ref, "Cached image must have a repository digest");
  assert(ref.endsWith(`@${image.Id}`), "Cached runtime manifest identity differs");
  assert(image.Os === "linux" && image.Architecture === "amd64", "Cached platform differs");
  // Keep the exact filesystem layers; only the release's configuration label changes.
  return `FROM ${ref}\nLABEL org.opencontainers.image.revision="${revision}"\nLABEL cc.saydian.build-input="${hash}"\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, revision] = process.argv.slice(2);
  assert(/^[a-f0-9]{40}$/.test(revision ?? ""));
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const entries = paths.filter(path => components.some(name => isComponentInput(name, path))).map(path => [path, readFileSync(path)]);
  for (const name of components) {
    const hash = inputHash(name, entries);
    const cache = `${repository}-${name}:input-${hash}`;
    let file = `docker/${name}.Dockerfile`, reused = false;
    if (command === "prepare" && process.env.ALLOW_COMPONENT_REUSE === "true") {
      // Cache absence or registry failure falls back to an ordinary build.
      const pulled = spawnSync("docker", ["pull", "--quiet", cache], { encoding: "utf8", timeout: 45000 });
      if (pulled.status === 0) {
        try {
          const [image] = JSON.parse(execFileSync("docker", ["image", "inspect", cache], { encoding: "utf8" }));
          const source = reuseDockerfile(name, image, hash, revision);
          file = `${process.env.RUNNER_TEMP}/${name}-reuse.Dockerfile`;
          writeFileSync(file, source);
          reused = true;
        } catch {
          console.log(`${name}: cache identity invalid; full build selected`);
        }
      }
    }
    assert(command === "prepare" || command === "publish");
    if (command === "prepare") {
      appendFileSync(process.env.GITHUB_OUTPUT, `${name}_file=${file}\n${name}_hash=${hash}\n`);
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${name}: ${reused ? "reuse verified filesystem layers" : "full build"}\n`);
    } else {
      const current = `${repository}-${name}:sha-${revision}`;
      const [image] = JSON.parse(execFileSync("docker", ["image", "inspect", current], { encoding: "utf8" }));
      assert(image.Config.Labels["cc.saydian.build-input"] === hash && image.Config.Labels["org.opencontainers.image.revision"] === revision);
      execFileSync("docker", ["tag", current, cache], { stdio: "inherit" });
      try {
        execFileSync("docker", ["push", cache], { stdio: "inherit", timeout: 45000 });
      } catch {
        console.log(`${name}: optional cache publication failed; verified release is unaffected`);
      }
    }
  }
}
