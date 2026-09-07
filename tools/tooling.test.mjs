import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60_000, windowsHide: true });
  return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
test("API reference is complete and up to date", () => {
  const result = run(process.execPath, ["tools/generate-api-reference.mjs", "--check"]);
  assert.equal(result.status, 0, result.output);
});
test("deployment shell syntax and receiver rejection", () => {
  for (const script of ["deploy-ci.sh", "ci-receiver.sh", "install-ci-receiver.sh"]) {
    const result = run(bash, ["-n", `deploy/scripts/${script}`]);
    assert.equal(result.status, 0, result.output);
  }
  const denied = run(bash, ["deploy/scripts/ci-receiver.sh", "release ../not-a-sha"]);
  assert.notEqual(denied.status, 0);
  assert.match(denied.output, /Only release SHA or status/);
});
test("automatic release preserves maintenance and rejects schema changes", () => {
  const script = fs.readFileSync(path.join(root, "deploy/scripts/deploy-ci.sh"), "utf8");
  assert.match(script, /prisma migrate status/);
  assert.doesNotMatch(script, /prisma migrate deploy|MAINTENANCE_READ_ONLY=false|compose down|docker.*prune/);
  assert.match(script, /trap 'rollback \$\?' ERR/);
  assert.match(script, /images\.yaml/);
  assert.match(script, /for page in admin down/);
  assert.match(script, /sha256sum --strict --check SHA256SUMS/);
  assert.match(script, /install -o root -g root -m 0644/);
  assert.match(script, /\.publish-app-update/);
  assert.match(script, /run_setting_tool restore/);
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /AUTO_DEPLOY_ENABLED == 'true'/);
  const productionWorkflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-production.yml"), "utf8");
  assert.match(productionWorkflow, /ServerAliveInterval=20.*ServerAliveCountMax=15.*TCPKeepAlive=yes/);
  assert.match(productionWorkflow, /release-assets\.githubusercontent\.com/);
  assert.match(productionWorkflow, /actions\/upload-artifact@v4/);
  assert.match(productionWorkflow, /PUBLISH_APP_UPDATE/);
});

test("download page stays public, immutable and outside Git artifacts", () => {
  const adminNginx = fs.readFileSync(path.join(root, "docker/admin-nginx.conf"), "utf8");
  const gateway = fs.readFileSync(path.join(root, "deploy/nginx/app-https.conf.template"), "utf8");
  const caddy = fs.readFileSync(path.join(root, "deploy/Caddyfile"), "utf8");
  const compose = fs.readFileSync(path.join(root, "deploy/compose.production.yaml"), "utf8");
  const configure = fs.readFileSync(path.join(root, "deploy/scripts/configure-shared-gateway.sh"), "utf8");
  assert.match(adminNginx, /location = \/down/);
  assert.match(adminNginx, /location \/down\/files\//);
  assert.match(adminNginx, /max-age=31536000, immutable/);
  assert.match(gateway, /location = \/down/);
  assert.match(caddy, /handle \/down/);
  assert.match(compose, /\.\/downloads:\/usr\/share\/nginx\/html\/down\/files:ro/);
  assert.match(configure, /awk/);
  assert.doesNotMatch(configure, /grep -Fq "\$marker"/);
});

test("safe Git workflow: fast-forward, dirty resume and remote divergence", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "saydian-git-test-"));
  function git(args, cwd) {
    const result = run("git", args, cwd);
    assert.equal(result.status, 0, result.output);
    return result.stdout.trim();
  }
  const remote = path.join(temporary, "origin.git");
  const repo = path.join(temporary, "work");
  const peer = path.join(temporary, "peer");
  const start = ["-NoProfile", "-NonInteractive", "-File", path.join(root, "tools/Start-Change.ps1"), "-RepositoryPath", repo, "-ExpectedRemote", remote];
  try {
    fs.mkdirSync(repo);
    git(["init", "--bare", "--initial-branch=main", remote], temporary);
    git(["init", "--initial-branch=main"], repo);
    for (const [key, value] of [["user.name", "CI Fixture"], ["user.email", "fixture@example.invalid"]]) git(["config", key, value], repo);
    fs.writeFileSync(path.join(repo, "fixture.txt"), "initial\n");
    git(["add", "fixture.txt"], repo);
    git(["commit", "-m", "fixture"], repo);
    git(["remote", "add", "origin", remote], repo);
    git(["push", "-u", "origin", "main"], repo);
    let result = run("pwsh", start);
    assert.equal(result.status, 0, result.output);
    fs.writeFileSync(path.join(repo, "fixture.txt"), "user modification\n");
    result = run("pwsh", start);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Uncommitted changes retained/);
    result = run("pwsh", [...start, "-Resume"]);
    assert.equal(result.status, 0, result.output);
    const publish = run("pwsh", ["-NoProfile", "-NonInteractive", "-File", path.join(root, "tools/Publish-Change.ps1"), "-RepositoryPath", repo, "-Message", "test", "-Files", "fixture.txt"]);
    assert.notEqual(publish.status, 0);
    assert.match(publish.output, /implementation log/);
    assert.equal(git(["diff", "--cached", "--name-only"], repo), "");
    git(["clone", remote, peer], temporary);
    for (const [key, value] of [["user.name", "CI Fixture"], ["user.email", "fixture@example.invalid"]]) git(["config", key, value], peer);
    fs.writeFileSync(path.join(peer, "peer.txt"), "remote change\n");
    git(["add", "peer.txt"], peer);
    git(["commit", "-m", "remote fixture"], peer);
    git(["push", "origin", "main"], peer);
    result = run("pwsh", [...start, "-Resume"]);
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(repo, "fixture.txt"), "utf8"), "user modification\n");
    // Only discard our isolated test edit, never a user's checkout.
    fs.writeFileSync(path.join(repo, "fixture.txt"), "initial\n");
    result = run("pwsh", start);
    assert.equal(result.status, 0, result.output);
    assert.equal(git(["rev-parse", "HEAD"], repo), git(["rev-parse", "origin/main"], repo));
    assert.equal(fs.readFileSync(path.join(repo, "peer.txt"), "utf8").replace(/\r\n/g, "\n"), "remote change\n");
  } finally {
    if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("saydian-git-test-")) fs.rmSync(temporary, { recursive: true, force: true });
  }
});
