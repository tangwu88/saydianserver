import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bash = process.env.SAYDIAN_BASH || (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash");
const globalSha = "b".repeat(40);
const domesticSha = "a".repeat(40);
function fixture(mode, args = [globalSha, domesticSha]) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "saydian-global-trigger-test-"));
  const bin = path.join(temporary, "bin");
  fs.mkdirSync(bin);
  const scripts = {
    id: "printf '0\\n'",
    git: `if [[ "$FIXTURE_MODE" == branch-changed ]]; then printf '%040d\\trefs/heads/codex/global-api-foundation\\n' 0; else printf '%s\\trefs/heads/codex/global-api-foundation\\n' "$GLOBAL_SHA"; fi`,
    curl: `last="\${@: -1}"
sha="$DOMESTIC_SHA"
if [[ "$last" == *'/global/'* ]]; then
  sha="cccccccccccccccccccccccccccccccccccccccc"
  if [[ "$FIXTURE_MODE" == already || ( -f "$FIXTURE_STATE" && "$FIXTURE_MODE" != wrong-revision ) ]]; then sha="$GLOBAL_SHA"; fi
elif [[ "$FIXTURE_MODE" == domestic-changed && -f "$FIXTURE_STATE" ]]; then sha="dddddddddddddddddddddddddddddddddddddddd"; fi
printf '{"status":"ready","database":"ok","revision":"%s"}\\n' "$sha"`,
    docker: `if [[ "$1" == ps ]]; then printf '123456789abc\\n'; exit 0; fi
printf 'SECRET_CONFIG=do-not-log-this\\n'
if [[ "$FIXTURE_MODE" == flags-changed && -f "$FIXTURE_STATE" ]]; then
  printf 'MAINTENANCE_READ_ONLY=false\\nBUSINESS_WRITES_PAUSED=false\\n'
else printf 'MAINTENANCE_READ_ONLY=true\\nBUSINESS_WRITES_PAUSED=true\\n'; fi`,
    systemctl: `printf '%s\\n' "$*" >> "$FIXTURE_CALLS"
if [[ "$1" == start ]]; then
  touch "$FIXTURE_STATE"
  [[ "$FIXTURE_MODE" != start-failed ]]
  exit $?
fi
property=
for arg in "$@"; do case "$arg" in --property=*) property="\${arg#--property=}";; esac; done
case "$property" in
  Unit) if [[ "$FIXTURE_MODE" == wrong-service ]]; then printf 'unrelated.service\\n'; else printf 'saydian-global-auto-deploy.service\\n'; fi;;
  LoadState) printf 'loaded\\n';;
  ExecMainStartTimestampMonotonic) if [[ -f "$FIXTURE_STATE" ]]; then printf '2\\n'; else printf '1\\n'; fi;;
  ActiveState) if [[ -f "$FIXTURE_STATE" && "$FIXTURE_MODE" == service-failed ]]; then printf 'failed\\n'; else printf 'inactive\\n'; fi;;
  SubState) printf 'dead\\n';;
  Result) printf 'success\\n';;
  ExecMainStatus) printf '0\\n';;
  LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus) printf 'LoadState=loaded\\nActiveState=inactive\\nSubState=dead\\nResult=success\\nExecMainCode=1\\nExecMainStatus=0\\n';;
  *) exit 2;;
esac`,
  };
  for (const [name, source] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${source}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  try {
    const result = spawnSync(bash, ["-c", 'if command -v cygpath >/dev/null; then FIXTURE_BIN=$(cygpath -u "$FIXTURE_BIN"); fi; export PATH="$FIXTURE_BIN:$PATH"; bash "$HELPER_SCRIPT" "$@"', "fixture", ...args], {
      cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true,
      env: { ...process.env, FIXTURE_BIN: bin, FIXTURE_MODE: mode, FIXTURE_STATE: path.join(temporary, "started"), FIXTURE_CALLS: path.join(temporary, "calls"), HELPER_SCRIPT: path.join(root, "deploy/scripts/trigger-global-deploy.sh"), GLOBAL_SHA: globalSha, DOMESTIC_SHA: domesticSha },
    });
    const calls = fs.existsSync(path.join(temporary, "calls")) ? fs.readFileSync(path.join(temporary, "calls"), "utf8") : "";
    return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, calls };
  } finally {
    if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("saydian-global-trigger-test-")) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test("global deployment helper and existing release script remain valid Bash", () => {
  for (const file of ["trigger-global-deploy.sh", "deploy-ci.sh"]) {
    const result = spawnSync(bash, ["-n", `deploy/scripts/${file}`], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
});
test("international trigger defaults to no operation and rejects incomplete SHA", () => {
  for (const args of [[], ["../invalid", domesticSha]]) {
    const result = fixture("normal", args);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  }
});
test("international trigger refuses a different installed timer target or changed branch", () => {
  for (const mode of ["wrong-service", "branch-changed"]) {
    const result = fixture(mode);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.calls, /^start /m);
  }
});
test("international trigger verifies exact revision and preserves domestic flags without logging credentials", () => {
  const result = fixture("normal");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, new RegExp(`Verified international revision: ${globalSha}`));
  assert.match(result.calls, /^start --no-block saydian-global-auto-deploy.service$/m);
  assert.doesNotMatch(result.output, /SECRET_CONFIG|do-not-log-this/);
  assert.doesNotMatch(result.calls, /restart|stop|enable|disable|daemon-reload/);
});
test("already deployed international source is verified without restarting service", () => {
  const result = fixture("already");
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.calls, /^start /m);
});
test("international failure and version mismatch stay failed after safe final checks", () => {
  for (const mode of ["service-failed", "wrong-revision", "start-failed"]) {
    const result = fixture(mode);
    assert.notEqual(result.status, 0, `${mode}: ${result.output}`);
    assert.match(result.output, /ExecMainStatus=0/);
    assert.doesNotMatch(result.calls, /^stop /m);
    assert.doesNotMatch(result.output, /SECRET_CONFIG|do-not-log-this/);
  }
});
test("international trigger fails if either realm flags or domestic revision changed", () => {
  for (const mode of ["flags-changed", "domestic-changed"]) {
    const result = fixture(mode);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /did not preserve domestic revision or runtime maintenance flags/);
  }
});
test("manual international workflow pins tested source and runs only after domestic rollback is disarmed", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-production.yml"), "utf8");
  const script = fs.readFileSync(path.join(root, "deploy/scripts/deploy-ci.sh"), "utf8");
  const helper = fs.readFileSync(path.join(root, "deploy/scripts/trigger-global-deploy.sh"), "utf8");
  assert.doesNotMatch(workflow.split("  workflow_dispatch:")[0], /global_revision:/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' && needs\.resolve\.outputs\.global_revision != ''/);
  assert.match(workflow, /needs\.verify-global\.result == 'success'/);
  assert.match(workflow, /git merge-base --is-ancestor "\$current" "\$GLOBAL_REVISION"/);
  assert.match(workflow, /git diff --exit-code "\$current" "\$GLOBAL_REVISION" -- apps\/api\/prisma\/schema\.prisma apps\/api\/prisma\/migrations/);
  assert.match(workflow, /pnpm typecheck\s+pnpm test\s+pnpm build/);
  assert.match(workflow, /test "\$global_actual" = "\$GLOBAL_REVISION"/);
  assert.ok(script.indexOf('bash "$source_dir/deploy/scripts/trigger-global-deploy.sh"') > script.lastIndexOf("trap - ERR INT TERM"));
  assert.match(helper, /deadline=\$\(\(SECONDS \+ 840\)\)/);
  assert.match(helper, /exit 124/);
  assert.doesNotMatch(helper, /journalctl|systemctl (stop|restart|enable|disable)|\.env\.production|auto-deploy\.sh/);
});
