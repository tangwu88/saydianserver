import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
const normalized = value => JSON.parse(JSON.stringify(value));
const parameters = { type: 'JSAPI', appId: 'wx-synthetic', timeStamp: 1792340000, nonceStr: 'synthetic', package: 'prepay_id=synthetic', signType: 'RSA', paySign: 'synthetic-signature' };
function environment(userAgent = 'MicroMessenger') {
  const listeners = new Set(), timers = new Map(), requests = [];
  let nextTimer = 0;
  const window = {}, document = { addEventListener(name, fn) { assert.equal(name, 'WeixinJSBridgeReady'); listeners.add(fn); }, removeEventListener(name, fn) { listeners.delete(fn); } };
  const context = { window, document, navigator: { userAgent }, URL, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  function load(file, dependencies = {}) {
    const source = readFileSync(new URL('../src/' + file + '.ts', import.meta.url), 'utf8').replace(/\/\* #ifdef MP-WEIXIN \*\/[\s\S]*?\/\* #endif \*\//g, '');
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { ...context, module, exports: module.exports, require(path) { assert.ok(path in dependencies, path); return dependencies[path]; } });
    return module.exports;
  }
  const model = load('commerce-model');
  const payments = load('payments', { './commerce-model': model, './api': { api: async (...args) => { requests.push(args); return { status: 'pending' }; } } });
  return { payments, model, window, listeners, timers, requests, ready() { for (const fn of [...listeners]) fn(); } };
}
test('iPhone/Android WeChat, ordinary browsers and Alipay choose the appropriate runtime', () => {
  for (const ua of ['iPhone MicroMessenger/8', 'Android MicroMessenger/8']) assert.equal(environment(ua).payments.paymentEnvironment(), 'wechat');
  for (const ua of ['iPhone Safari/604', 'Android Chrome/130', 'AlipayClient/10']) assert.equal(environment(ua).payments.paymentEnvironment(), 'browser');
});
test('JSAPI waits for the real bridge, invokes once and strips transport metadata', async () => {
  const h = environment(), calls = [], pending = h.payments.invokePayment(parameters);
  assert.equal(h.listeners.size, 1);
  h.window.WeixinJSBridge = { invoke(method, fields, callback) { calls.push({ method, fields }); callback({ err_msg: 'get_brand_wcpay_request:ok' }); } };
  h.ready(); h.ready();
  assert.deepEqual(normalized(await pending), { pending: true });
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'getBrandWCPayRequest');
  assert.equal(calls[0].fields.timeStamp, String(parameters.timeStamp)); assert.equal('type' in calls[0].fields, false);
  assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
  assert.deepEqual(normalized(await h.payments.confirmPayment('payment-a')), { payment: { status: 'pending' }, paid: false });
});
test('late bridge cannot launch an old account payment', async () => {
  const h = environment(); let current = true, invoked = 0;
  const pending = h.payments.invokePayment(parameters, () => current);
  current = false; h.window.WeixinJSBridge = { invoke() { invoked++; } }; h.ready();
  await assert.rejects(pending, /账号或页面已变化/); assert.equal(invoked, 0);
});
test('bridge initialization times out with a retryable order message and removes listeners', async () => {
  const h = environment(), pending = h.payments.invokePayment(parameters);
  const rejected = assert.rejects(pending, /重新打开本订单/);
  [...h.timers.values()][0](); await rejected;
  assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});
test('cancellation and provider failure never become payment success', async () => {
  for (const [result, message] of [['cancel', /已取消支付/], ['fail', /微信支付未完成/]]) {
    const h = environment(); h.window.WeixinJSBridge = { invoke(method, fields, callback) { callback({ err_msg: 'get_brand_wcpay_request:' + result }); } };
    await assert.rejects(h.payments.invokePayment(parameters), message);
    assert.equal(h.requests.length, 0);
  }
});
test('invalid JSAPI parameters cannot invoke the bridge', async () => {
  const h = environment(); let invoked = 0; h.window.WeixinJSBridge = { invoke() { invoked++; } };
  for (const override of [{ package: 'other' }, { paySign: '' }, { signType: 'MD5' }, { timeStamp: 'invalid' }]) await assert.rejects(h.payments.invokePayment({ ...parameters, ...override }), /支付参数无效/);
  assert.equal(invoked, 0);
});
test('environment-specific choices use configured capabilities, without duplicating Alipay', () => {
  const { checkoutPaymentOptions: options } = environment().model;
  const caps = [{ channel: 'wechat_jsapi', enabled: true }, { channel: 'alipay_wap', enabled: true }, { channel: 'alipay_page', enabled: true }];
  assert.deepEqual(normalized(options(caps, 'wechat', false)).map(x => x.channel), ['wechat_jsapi', 'alipay_browser']);
  assert.deepEqual(normalized(options(caps, 'browser', false)).map(x => x.channel), ['alipay_wap', 'wechat_open']);
  assert.deepEqual(normalized(options(caps, 'browser', true)).map(x => x.channel), ['alipay_page', 'wechat_open']);
  assert.deepEqual(normalized(options(caps.map(x => ({ ...x, enabled: false })), 'wechat', false)), []);
  assert.deepEqual(normalized(options(caps, 'mini', false)), []);
});
test('browser handoff choices cannot create provider payment requests', async () => {
  const h = environment();
  for (const channel of ['alipay_browser', 'wechat_open']) await assert.rejects(h.payments.createOrderPayment('order-a', channel), /原订单/);
  assert.equal(h.requests.length, 0);
  await h.payments.createOrderPayment('order-a', 'ALIPAY_WAP');
  assert.equal(h.requests[0][1].data.channel, 'alipay_wap');
  assert.equal(h.requests[0][1].data.idempotencyKey, 'commerce-payment:order-a:alipay_wap');
});
