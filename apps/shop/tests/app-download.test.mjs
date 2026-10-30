import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app-download.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, require });
const { storeDownloadConfig } = module.exports;
test('download defaults are separate product pages; disabled or invalid persisted configuration hides entry', () => {
  assert.equal(storeDownloadConfig({}).ringUrl, 'https://app.saydian.cn/down2');
  assert.equal(storeDownloadConfig({ 'store.appDownload': { enabled: false, value: {} } }), null);
  assert.equal(storeDownloadConfig({ 'store.appDownload': { enabled: true, value: { cnUrl: 'javascript:alert(1)' } } }), null);
  assert.equal(storeDownloadConfig({ 'store.appDownload': { enabled: true, value: { title: '下载配套 APP' } } }).title, '下载配套 APP');
});
test('first bootstrap remains unloaded until configuration has arrived', async () => {
  let done;
  const response = new Promise(resolve => { done = resolve; });
  const source = readFileSync(new URL('../src/storefront.ts', import.meta.url), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, require(name) {
    if (name === 'vue') return { reactive: v => v };
    if (name === './realm') return { isGlobalMall: true, mallStorage: {} };
    if (name === './api') return { api: () => response };
    if (name.endsWith('.png')) return '';
    throw Error(name);
  } });
  const state = module.exports;
  assert.equal(state.storefront.loaded, false);
  const pending = state.loadStorefront();
  assert.equal(state.storefront.loaded, false);
  done({ featured: [{ id: 'p' }], configs: { 'store.appDownload': { enabled: false } } });
  await pending;
  assert.equal(state.storefront.loaded, true);
  assert.equal(storeDownloadConfig(state.storefront.configs), null);
});
