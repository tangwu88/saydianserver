import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
test(
  "legacy release and rollback cannot race the unified migration lock",
  { skip: process.platform !== "linux" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "care-lock-test-"));
    mkdirSync(join(root, "deploy"));
    const held = spawn(
      "bash",
      [
        "-c",
        'exec 9>"$1/deploy/.ci-release.lock"; flock -n 9 || exit 1; echo held; read -r value',
        "fixture",
        root,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Lock fixture did not start")),
          3000,
        );
        held.stdout.once("data", (data) => {
          clearTimeout(timer);
          assert.equal(String(data).trim(), "held");
          resolve();
        });
        held.once("error", reject);
      });
      for (const file of ["release.sh", "rollback.sh"]) {
        const result = spawnSync(
          "sh",
          [fileURLToPath(new URL(file, import.meta.url))],
          {
            encoding: "utf8",
            env: { ...process.env, DEPLOY_ROOT: root, IMAGE_TAG: "synthetic" },
            timeout: 3000,
          },
        );
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(
          result.stdout + result.stderr,
          /Care privacy|previous-image-tag|env.production/,
        );
      }
    } finally {
      held.stdin.end("done\n");
      await new Promise((resolve) =>
        held.exitCode === null ? held.once("exit", resolve) : resolve(),
      );
      rmSync(root, { recursive: true, force: true });
    }
  },
);
