import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { realmTestModules } from '../../../tools/h5-realm-fixture.mjs';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(name, imports, globals = {}) {
  const module = { exports: {} };
  const source = readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, Error, ArrayBuffer, Uint8Array, ...globals, require: key => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } });
  return module.exports;
}
test('mini referral and public capabilities work without URL, URLSearchParams, window or document', async () => {
  const storage = new Map(), requests = [], redirects = [];
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    request(input) { requests.push(input); input.success({ statusCode: 200, data: { login: {} } }); }, navigateTo: value => redirects.push(value.url) };
  const { realm, config } = realmTestModules(uni, { mini: true });
  const session = load('session.ts', { './realm': realm, './api': {} }, { getCurrentPages: () => [{ options: { ref: 'synthetic-ref' } }] });
  session.captureReferral(); assert.equal(storage.get('saidian-ref'), 'synthetic-ref');
  const api = load('api.ts', { './realm': realm, './realm-config': config, './commerce-model': { safeMallRoute: () => '/pages/profile/index' } }, { uni });
  await api.api('/storefront/capabilities'); assert.match(requests[0].url, /client=mini&locale=zh-Hans$/);
  await assert.rejects(api.ensureMiniProgramSession(true), /阅读并同意/); assert.equal(requests.length, 1);
});
function imageFixture() {
  let stamp = 'current'; const requests = [], writes = [], deleted = [], uploads = [];
  const filesystem = { writeFile(input) { writes.push(input); }, unlink(input) { deleted.push(input.filePath); } };
  const wx = { env: { USER_DATA_PATH: 'wxfile://private' }, getFileSystemManager: () => filesystem };
  const uni = { request(input) { requests.push(input); return { abort() { input.fail(); } }; }, uploadFile(input) { uploads.push(input); return { abort() {}, onProgressUpdate() {} }; }, getImageInfo(input) { input.success({ type: 'png' }); } };
  const images = load('after-sale-images.ts', { './api': { API_BASE: 'https://app.saydian.cn/api/saidian-mall/v1', mallSessionStamp: () => stamp }, './realm': { isGlobalMall: false, mallStorage: { get: key => key === 'saidian-user' ? { id: 'member' } : 'synthetic-token' } } }, { wx, uni });
  return { images, client: images.createAfterSaleImageClient(), requests, writes, deleted, uploads, switch() { stamp = 'another-account'; } };
}
const imageId = '12345678-1234-4234-8234-123456789012';
test('mini private image preview uses authenticated arraybuffer requests and removes local files on release', async () => {
  const h = imageFixture(), pending = h.client.preview(imageId);
  assert.equal(h.requests[0].header.Authorization, 'Bearer synthetic-token'); assert.equal(h.requests[0].responseType, 'arraybuffer');
  h.requests[0].success({ statusCode: 200, header: { 'Content-Type': 'image/png' }, data: new ArrayBuffer(4) });
  h.writes[0].success(); const path = await pending; assert.ok(path.startsWith('wxfile://private/after-sale-'));
  h.client.release(path); assert.deepEqual(h.deleted, [path]);
});
test('account change during a mini file write deletes the private image and rejects the stale result', async () => {
  const h = imageFixture(), pending = h.client.preview(imageId);
  h.requests[0].success({ statusCode: 200, header: { 'content-type': 'image/png' }, data: new ArrayBuffer(4) });
  h.switch(); h.writes[0].success(); await assert.rejects(pending, /账号已变化/); assert.equal(h.deleted.length, 1);
});
test('mini preview rejects unauthorized or oversized data before writing any file', async () => {
  for (const response of [{ statusCode: 401 }, { statusCode: 200, header: { 'content-type': 'text/html' }, data: new ArrayBuffer(4) }, { statusCode: 200, header: { 'content-type': 'image/png' }, data: new ArrayBuffer(10485761) }]) {
    const h = imageFixture(), pending = h.client.preview(imageId); h.requests[0].success(response); await assert.rejects(pending); assert.equal(h.writes.length, 0);
  }
});
test('mini temp files without an extension get their image format from the native image API', async () => {
  const h = imageFixture(); const file = await h.images.selectedEvidenceFile({ path: 'wxfile://temporary/file.tmp', size: 4 });
  assert.equal(file.type, 'image/png'); assert.equal(file.size, 4);
  const pending = h.client.upload(file, () => {}); assert.equal(h.uploads[0].url, 'https://app.saydian.cn/api/saidian-mall/v1/storefront/after-sale-images');
  h.uploads[0].success({ statusCode: 200, data: JSON.stringify({ id: imageId, byteSize: 4, contentType: 'image/png', sha256: 'a'.repeat(64) }) }); await pending;
});
test('native poster renders a QR matrix and exports a PNG without DOM or TextEncoder', async () => {
  const calls = [], context = Object.fromEntries(['setFillStyle', 'fillRect', 'setFontSize', 'fillText', 'drawImage'].map(key => [key, (...args) => calls.push([key, ...args])]));
  context.draw = (_, callback) => callback();
  const poster = load('mini-poster.ts', { qrcode: require('qrcode') }, { wx: { getFileSystemManager() {} }, uni: { createCanvasContext: () => context, canvasToTempFilePath: input => input.success({ tempFilePath: 'wxfile://poster.png' }) } });
  assert.equal(Buffer.from(poster.posterUtf8('赛电')).toString('utf8'), '赛电');
  assert.equal(await poster.buildMiniPoster('poster', {}, { title: '商品', qrText: 'https://app.saydian.cn/saidian-mall/' }), 'wxfile://poster.png');
  assert.ok(calls.filter(([key]) => key === 'fillRect').length > 100);
});
