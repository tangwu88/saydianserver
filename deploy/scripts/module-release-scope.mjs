import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const moduleBase = "aeb9afcb8bbd8b4168c38e489c827790c448bf7a";
export const moduleSource = "825cc514cf26d67d1e47bb0fb5a59e6a1bec91db";
const sha = /^[a-f0-9]{40}$/;
const releaseFiles = new Set([
  ".github/workflows/ci.yml", ".github/workflows/deploy-production.yml",
  "deploy/scripts/deploy-unified.sh", "deploy/scripts/module-release-scope.mjs",
  "deploy/scripts/module-release-scope.test.mjs", "tools/tooling.test.mjs",
  "deploy/scripts/deploy-failure.test.mjs",
  "docs/handoff.md", "docs/say-ring-ios-module-visibility.md",
  "docs/implementation-log/2026-10-18-say-ring-module-visibility.md",
]);

export function validateReleasePaths(paths) {
  assert(paths.every(path => releaseFiles.has(path)), "Runtime differs from the verified module-only source");
}

export function validateModuleApproval(approval, proof, revision, now = Date.now()) {
  assert(sha.test(revision) && revision !== moduleBase && revision !== moduleSource);
  assert(proof.schemaVersion === 1 && proof.revision === revision && proof.baseRevision === moduleBase && proof.runtimeSource === moduleSource, "Module release scope mismatch");
  assert(approval.schemaVersion === 1 && approval.revision === revision && approval.baseRevision === moduleBase && approval.runtimeSource === moduleSource, "Exact root approval missing");
  assert(Number.isSafeInteger(approval.expiresAt) && approval.expiresAt > now && approval.expiresAt <= now + 2 * 60 * 60 * 1000, "Root approval expired or overbroad");
}

export function validateModuleEnvironment(compose, live, images) {
  const environment = entries => Object.fromEntries(entries.map(value => { const at = value.indexOf("="); return [value.slice(0, at), value.slice(at + 1)]; }).filter(([key]) => key !== "APP_REVISION"));
  for (const [index, name] of ["api", "worker", "admin"].entries()) {
    assert(live[index].Name === `/saydian-global-global-${name}-1`);
    const expected = { ...environment(images[index].Config.Env ?? []), ...compose.services[`global-${name}`].environment };
    delete expected.APP_REVISION;
    assert(isDeepStrictEqual(environment(live[index].Config.Env), expected), `Existing ${name} environment would change`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, revision, approvalFile, proofFile] = process.argv.slice(2);
  if (command === "environment") {
    validateModuleEnvironment(...[revision, approvalFile, proofFile].map(file => JSON.parse(readFileSync(file, "utf8"))));
  } else if (command === "source") {
    assert(sha.test(revision ?? ""));
    const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
    assert(git(["rev-parse", "HEAD"]) === revision, "Checkout differs from release");
    git(["merge-base", "--is-ancestor", moduleBase, revision]);
    git(["merge-base", "--is-ancestor", moduleSource, revision]);
    validateReleasePaths(git(["diff", "--name-only", moduleSource, revision]).split("\n").filter(Boolean));
    console.log(JSON.stringify({ schemaVersion: 1, revision, baseRevision: moduleBase, runtimeSource: moduleSource }));
  } else {
    assert(command === "approval");
    assert(sha.test(revision ?? ""));
    const stat = lstatSync(approvalFile);
    assert(stat.isFile() && stat.uid === 0 && (stat.mode & 0o777) === 0o600, "Approval must be a root-owned 0600 regular file");
    validateModuleApproval(JSON.parse(readFileSync(approvalFile, "utf8")), JSON.parse(readFileSync(proofFile, "utf8")), revision);
  }
}
