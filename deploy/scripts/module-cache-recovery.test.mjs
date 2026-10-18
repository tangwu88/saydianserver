import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import test from 'node:test';

test('cache-only receiver rejects a different revision before any external command', () => {
  const result = spawnSync('bash', ['deploy/scripts/receive-module-cache-recovery.sh'], {
    env: { PATH: process.env.PATH, RELEASE_SHA: '0'.repeat(40), RELEASE_SOURCE: '/opt/saydianapp-server/releases/ci-test' },
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.length, 0);
});
test('cache sender cannot be invoked from a local terminal or ordinary main', () => {
  for (const GITHUB_REF of ['', 'refs/heads/main']) {
    const result = spawnSync('bash', ['deploy/scripts/send-module-cache-recovery.sh', 'unused'], {
      env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'tangwu88/saydianserver', GITHUB_REF },
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.length, 0);
  }
});
test('ordinary main guards and accepted importer remain byte-identical', () => {
  for (const path of ['deploy/scripts/send-offline-images.sh', 'deploy/scripts/send-runtime-artifact.sh', 'deploy/scripts/receive-offline-images.sh', 'deploy/scripts/receive-runtime-artifact.sh', 'deploy/scripts/runtime-artifact.mjs', 'deploy/scripts/deploy-unified.sh']) {
    assert.deepEqual(readFileSync(path), execFileSync('git', ['show', `dcc9d2aefeb42b3a0345868a5debc51e8625b213:${path}`]));
  }
  const receiver = readFileSync('deploy/scripts/receive-module-cache-recovery.sh', 'utf8');
  assert(receiver.indexOf('module-release-scope.mjs approval') < receiver.indexOf('exec bash'));
  assert(receiver.includes('.artifactId == "12140071512"'));
  assert(receiver.includes('eb32f72523215dfd6df79ee4aada0395cd62b26cdd81986ab0f52fdd137a7db1'));
  assert(receiver.includes('exec bash "$payload/scripts/receive-runtime-artifact.sh"'));
  assert(!/compose|migrate|seed|AppSetting|systemctl|docker load/.test(receiver));
});
