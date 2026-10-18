import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  bashCommand,
  shellArgs,
  shellEnvironment,
  writeNodeDouble,
} from "../../tools/shell-test-fixture.mjs";
test("legacy entrypoints preserve known CONTACT databases but refuse protected, partial and failed queries despite compatibility flags", () => {
  const bin = mkdtempSync(join(tmpdir(), "care-legacy-test-"));
  try {
    writeNodeDouble(
      bin,
      "docker",
      `const a=process.argv.slice(2);if(a[0]==='ps')console.log('saydian-global-global-postgres-1');else if(a[0]==='exec'){require('node:fs').readFileSync(0);if(process.env.FIXTURE_SCHEMA==='failed')process.exit(1);console.log(process.env.FIXTURE_SCHEMA);}else process.exit(1);`,
    );
    for (const state of ["legacy", "protected", "unknown", "failed"]) {
      const result = spawnSync(
        bashCommand,
        shellArgs(
          bin,
          fileURLToPath(new URL("./care-privacy-gate.sh", import.meta.url)),
        ).concat("legacy"),
        {
          encoding: "utf8",
          env: shellEnvironment(bin, {
            FIXTURE_SCHEMA: state,
            CARE_PRIVACY_COMPATIBLE: "true",
            care_legacy_entry: "true",
          }),
          timeout: 10000,
        },
      );
      assert.equal(
        result.status === 0,
        state === "legacy",
        result.stdout + result.stderr,
      );
    }
    for (const name of ["release.sh", "rollback.sh"]) {
      const code = readFileSync(new URL(name, import.meta.url), "utf8");
      assert(code.indexOf("care-privacy-gate.sh") < code.indexOf("sed -i"));
    }
    const us = readFileSync(
      new URL("../us/deploy.sh", import.meta.url),
      "utf8",
    );
    assert(
      us.indexOf("20261018070000_care_identity_disclosure") <
        us.indexOf('"${compose[@]}" pull'),
    );
    assert(us.indexOf("privacy_state") < us.indexOf("trap 'rollback' ERR"));
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
