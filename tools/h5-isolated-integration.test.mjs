import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Exercise only the side-effect-free listener wrapper, never bootstrap acceptance.
const source = await readFile(new URL("./h5-isolated-integration.mjs", import.meta.url), "utf8");
const listenerFunction = source.match(/function listeners\(\) \{[\s\S]*?\n\}/)?.[0];
assert(listenerFunction);
function snapshot(rows) {
  const result = runInNewContext(`(${listenerFunction})()`, {
    assert, process: { platform: "win32" },
    execFileSync(file, args, options) {
      assert.equal(file, "powershell.exe");
      assert.equal(options.windowsHide, true);
      const command = args.at(-1);
      assert(command.includes("ConvertTo-Json -Compress -InputObject @("));
      assert(command.includes("Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object"));
      assert(command.includes("$_.LocalPort -in 8080,5173,8081"));
      assert(!command.includes("-LocalPort 8080"));
      return JSON.stringify(rows);
    },
  });
  return JSON.parse(JSON.stringify(result));
}
test("an absent original API/admin is a valid empty listener snapshot", () => {
  assert.deepEqual(snapshot([]), []);
});
test("one demo listener still remains an array with PID and start time", () => {
  const rows = [{ port: 8081, pid: 123, start: "2026-09-11T01:00:00.0000000Z" }];
  assert.deepEqual(snapshot(rows), rows);
});
test("snapshots preserve all original listeners and detect process replacement", () => {
  const rows = [8080, 5173, 8081].map(port => ({ port, pid: port + 1, start: "2026-09-11T01:00:00Z" }));
  assert.deepEqual(snapshot(rows), rows);
  const changed = structuredClone(rows); changed[2].pid++;
  assert.notDeepEqual(snapshot(changed), snapshot(rows));
  changed[2].pid = rows[2].pid; changed[2].start = "2026-09-11T02:00:00Z";
  assert.notDeepEqual(snapshot(changed), snapshot(rows));
});
test("readiness checks only target original listeners that existed, without dropping preservation checks", () => {
  assert.equal((source.match(/if \(beforeListeners\.some\(row => row\.port === 8080\)\)/g) || []).length, 2);
  assert.equal((source.match(/if \(beforeListeners\.some\(row => row\.port === 5173\)\)/g) || []).length, 1);
  assert(source.includes("check(listeners(), beforeListeners"));
  assert(!source.includes("original API/admin listeners present"));
});
test("quote repricing acceptance uses current-run assets and checks stale-write and exact-replay boundaries", () => {
  assert(source.includes('newProduct(1000, 3, "quote-fingerprint")'));
  assert(source.includes("owned.coupons.push(fingerprintCoupon.id)"));
  assert(source.includes('check(staleCreate.status, 409'));
  assert(source.includes('check(staleCreate.json.errorKey, "quote_changed"'));
  assert(source.includes("check(await fingerprintAssets(), beforeStaleCreate"));
  assert(source.includes("check(fingerprintReplay.id, fingerprintOrder.id"));
  assert(source.includes("check(await fingerprintAssets(), afterFreshCreate"));
  assert(source.includes('check(differentFingerprintRetry.status, 409'));
});
