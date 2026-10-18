import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { moduleBase, moduleSource, validateReleasePaths, validateModuleApproval, validateModuleEnvironment } from "./module-release-scope.mjs";

test("isolated release permits deployment plumbing but no additional runtime, SMTP, ID or migrations", () => {
  validateReleasePaths([".github/workflows/ci.yml", "deploy/scripts/deploy-unified.sh", "docs/handoff.md"]);
  for (const path of ["apps/api/src/admin/admin.service.ts", "apps/api/src/auth/wecom-email.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/new/migration.sql", "packages/contracts/src/index.ts", "deploy/compatible-migrations.json", "docker/admin-nginx.conf"])
    assert.throws(() => validateReleasePaths([path]), /Runtime differs/);
});

test("isolated deployment needs exact, unexpired root approval for its fixed verified source", () => {
  const now = 10000000, revision = "b".repeat(40);
  const proof = { schemaVersion: 1, revision, baseRevision: moduleBase, runtimeSource: moduleSource };
  const approval = { ...proof, expiresAt: now + 60000 };
  validateModuleApproval(approval, proof, revision, now);
  for (const change of [{ revision: "c".repeat(40) }, { baseRevision: "c".repeat(40) }, { runtimeSource: "c".repeat(40) }, { expiresAt: now }, { expiresAt: now + 7200001 }])
    assert.throws(() => validateModuleApproval({ ...approval, ...change }, proof, revision, now));
  assert.throws(() => validateModuleApproval(approval, { ...proof, revision: "c".repeat(40) }, revision, now));
});

test("one-shot release preserves ordinary main guard and forbids schema/gateway changes", () => {
  const script = readFileSync(new URL("./deploy-unified.sh", import.meta.url), "utf8");
  assert(script.includes("module-release-approval.json"));
  assert(script.includes("Scoped module release cannot contain pending migrations"));
  assert(script.includes("Existing settings changed during module release"));
  assert(script.includes("git/ref/heads/main"));
  assert(script.includes('if [[ "$first" != true && "$scoped_modules" != true ]]; then'));
  assert(script.includes('sha256sum --check "$backup/gateway.sha256"'));
});

test("deployment rejects changed SMTP, signing or other environment values before switching", () => {
  const names = ["api", "worker", "admin"];
  const compose = { services: Object.fromEntries(names.map(name => [`global-${name}`, { environment: { CLOSED: "true", APP_REVISION: "new" } }])) };
  const live = names.map(name => ({ Name: `/saydian-global-global-${name}-1`, Config: { Env: ["PATH=/original", "CLOSED=true", "APP_REVISION=old"] } }));
  const images = names.map(() => ({ Config: { Env: ["PATH=/original"] } }));
  validateModuleEnvironment(compose, live, images);
  for (const key of ["SMTP_HOST", "ACCESS_TOKEN_SECRET", "CLOSED"]) {
    const changed = structuredClone(compose); changed.services["global-api"].environment[key] = "changed";
    assert.throws(() => validateModuleEnvironment(changed, live, images), /environment would change/);
  }
});
