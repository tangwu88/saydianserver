import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(referral = '') {
  const calls = [], clipboard = [], module = { exports: {} };
  const imports = { './realm': { mallStorage: { get: () => referral } }, './api': { api: async (path, input) => { calls.push({ path, input });return { urlLink: 'https://wxaurl.cn/synthetic' }; } } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/mini-share.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, require: key => imports[key], wx: { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) }, uni: { setClipboardData: input => clipboard.push(input.data) } });
  return { share: module.exports, calls, clipboard };
}
test('native card paths preserve product and home referrals without H5 URLs', () => {
  const h = load('ref_42');
  assert.equal(h.share.miniSharePath(), '/pages/home/index?ref=ref_42');
  assert.equal(h.share.miniSharePath('product-id'), '/pages/product/index?id=product-id&ref=ref_42');
  assert.equal(load('bad&ref').share.miniSharePath(), '/pages/home/index');
});
test('copy links uses the WeChat URL Link and actual mini environment', async () => {
  const h = load('ref_42');await h.share.copyMiniShareLink();
  assert.equal(h.clipboard[0], 'https://wxaurl.cn/synthetic');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { path: '/storefront/mini-share', input: { method: 'POST', data: { kind: 'link', page: 'home', envVersion: 'trial', referral: 'ref_42' } } });
});
