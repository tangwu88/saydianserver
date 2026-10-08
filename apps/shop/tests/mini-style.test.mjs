import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { parse, compileScript } = require('vue/compiler-sfc');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../mini-style.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require, Set, Error });
const { miniVueStyles, miniSelectors } = module.exports;

test('mini adaptation preserves expressions and events while keeping titles and amounts inline', () => {
  const source = `<template><view class="total"><h2>合计</h2><b :class="{active:ok}">{{ money(total) }}</b><button :disabled="busy" @click="pay">付款</button></view></template><script setup>const busy=false, ok=true, total=12; const money=v=>v; const pay=()=>{};</script><style scoped>.total b{color:red}.total h2{font-size:20px}button[disabled]{opacity:.5}</style>`;
  const adapted = miniVueStyles(source, '/shop/components/Amount.vue');
  assert.match(adapted, /<text class="mini-node mini-b" :class="\{active:ok\}">\{\{ money\(total\) \}\}<\/text>/);
  assert.match(adapted, /\.total \.mini-b\{color:red\}/);
  assert.match(adapted, /\.mini-button\.mini-disabled/);
  assert.match(adapted, /@click="pay"/);
  assert.match(adapted, /styleIsolation: "shared"/);
  const parsed = parse(adapted);
  assert.deepEqual(parsed.errors, []);
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'test' }));
  assert.match(source, /<b /); // H5 source remains untouched.
});

test('disabled classes merge with existing dynamic class bindings', () => {
  const source = `<template><button :class="active?'selected':''" :disabled="!ready || busy">支付</button></template>`;
  const adapted = miniVueStyles(source, '/shop/pages/payment.vue');
  assert.match(adapted, /\[active\?'selected':'', \{ 'mini-disabled': !!\(!ready \|\| busy\) \}\]/);
  assert.deepEqual(parse(adapted).errors, []);
});

test('all storefront pages and components remain valid Vue after mini adaptation', () => {
  const root = new URL('../src/', import.meta.url);
  const scan = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? scan(new URL(entry.name+'/', directory)) : entry.name.endsWith('.vue') ? [new URL(entry.name, directory)] : []);
  for (const file of scan(root)) {
    const adapted = miniVueStyles(readFileSync(file, 'utf8'), file.pathname);
    const { descriptor, errors } = parse(adapted);
    assert.deepEqual(errors, [], file.pathname);
    if (descriptor.scriptSetup) assert.doesNotThrow(() => compileScript(descriptor, { id: file.pathname }), file.pathname);
    if (descriptor.template) assert.doesNotMatch(descriptor.template.content, /<\/?(?:b|h[1-6]|strong|p|span)\b/, file.pathname);
  }
});

test('selectors adapt native descendants without altering CSS values or media queries', () => {
  assert.equal(miniSelectors('@media(max-width:600px){.row>view,image{color:#b00;background:url("/b.png")}}'), '@media(max-width:600px){.row>.mini-view,.mini-image{color:#b00;background:url("/b.png")}}');
});
