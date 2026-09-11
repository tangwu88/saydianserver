import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { realmTestModules } from '../../../tools/h5-realm-fixture.mjs';

const ts = createRequire(import.meta.url)('typescript');
function page(name, api, initial = new Map()) {
  const storage = initial, hooks = {};
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), getStorageInfoSync: () => ({ keys: [...storage.keys()] }) };
  const { realm } = realmTestModules(uni, { env: { VITE_APP_REALM: 'global' } });
  const source = readFileSync(new URL(`../src/pages/${name}/index.vue`, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const exports = name === 'category' ? '({selected,products,total,busy,error,initialize,load,select,retry})' : '({keyword,sort,products,total,busy,error,search,setSort,retry})';
  const module = { exports: {} };
  const compiled = ts.transpileModule(source + `\nmodule.exports=${exports};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, uni, Error,
    require(name) {
      if(name === 'vue') return { ref: value => ({value}), computed: getter => ({get value(){return getter();}}) };
      if(name === '@dcloudio/uni-app') return { onLoad: fn => hooks.load=fn, onShow: fn => hooks.show=fn };
      if(name === '../../api') return {api};
      if(name === '../../realm') return realm;
      if(name.endsWith('.vue')) return {};
      throw new Error('Unexpected import '+name);
    },
  });
  return {...module.exports, hooks, realm, storage};
}
const deferred = () => { let resolve, reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const data = (id,total=1) => ({items:[{id}],total});
const categories = [{id:'watch',name:'手表'},{id:'accessory',name:'配件'}];

test('global category reset consumes the namespaced explicit all-products selection', async () => {
  const h=page('category',async path=>path.endsWith('bootstrap')?{categories}:data(path));
  await h.initialize();await h.select('watch');
  h.realm.mallStorage.set('saidian-category-selected','');
  assert.equal(h.realm.mallStorage.has('saidian-category-selected'),true);
  await h.initialize();
  assert.equal(h.selected.value,'');assert.equal(h.products.value[0].id.includes('categoryId'),false);
  assert.equal(h.realm.mallStorage.has('saidian-category-selected'),false);
});
test('category remembers current tab on return but clears a category removed by the backend', async () => {
  let available=categories;
  const h=page('category',async path=>path.endsWith('bootstrap')?{categories:available}:data('ok'));
  await h.initialize();await h.select('watch');await h.initialize();assert.equal(h.selected.value,'watch');
  available=[categories[1]];await h.initialize();assert.equal(h.selected.value,'');
});
test('new category errors clear stale products, persist an error and can retry',async()=>{
  let fail=false;
  const h=page('category',async path=>{if(path.endsWith('bootstrap'))return {categories};if(fail)throw new Error('网络不可用');return data('watch');});
  await h.initialize();fail=true;await h.select('accessory');
  assert.equal(h.products.value.length,0);assert.equal(h.total.value,0);assert.equal(h.error.value,'网络不可用');assert.equal(h.busy.value,false);
  fail=false;await h.retry();assert.equal(h.error.value,'');assert.equal(h.products.value.length,1);
});
test('bootstrap failure retry reloads category metadata, not only the item list',async()=>{
  let fail=true,calls=0;
  const h=page('category',async path=>{if(path.endsWith('bootstrap')){calls++;if(fail)throw new Error('分类加载失败');return {categories};}return data('ok');});
  await h.initialize();assert.equal(h.error.value,'分类加载失败');fail=false;await h.retry();assert.equal(calls,2);assert.equal(h.error.value,'');
});
test('category older response cannot overwrite the newer selection',async()=>{
  const first=deferred(), second=deferred();
  const h=page('category',path=>path.includes('watch')?first.promise:second.promise);
  const a=h.select('watch'),b=h.select('accessory');second.resolve(data('new'));await b;first.resolve(data('old'));await a;
  assert.equal(h.products.value[0].id,'new');assert.equal(h.selected.value,'accessory');
});
test('editing search input before loading more keeps the submitted keyword and correct next page',async()=>{
  const calls=[];
  const h=page('search',async path=>{calls.push(path);return data(path,30);});
  h.keyword.value=' A ';await h.search();h.keyword.value='B';await h.search(true);
  assert.match(calls[1],/page=2&.*keyword=A&/);assert.equal(h.products.value.length,2);
  await h.search();assert.match(calls[2],/page=1&.*keyword=B&/);assert.equal(h.products.value.length,1);
});
test('new failed search clears old results while page-two failure preserves rows and retries page two',async()=>{
  let fail=false;const calls=[];
  const h=page('search',async path=>{calls.push(path);if(fail)throw new Error('搜索连接失败');return data(path,30);});
  h.keyword.value='A';await h.search();fail=true;await h.search(true);
  assert.equal(h.products.value.length,1);assert.equal(h.error.value,'搜索连接失败');
  h.keyword.value='B';fail=false;await h.retry();assert.match(calls.at(-1),/page=2&.*keyword=A&/);
  fail=true;await h.search();assert.equal(h.products.value.length,0);assert.equal(h.total.value,0);assert.equal(h.error.value,'搜索连接失败');
});
test('late search failures do not replace newer results with stale error',async()=>{
  const first=deferred(),second=deferred();
  const h=page('search',path=>path.includes('keyword=A')?first.promise:second.promise);
  h.keyword.value='A';const a=h.search();h.keyword.value='B';const b=h.search();second.resolve(data('B'));await b;
  first.reject(new Error('stale error'));await a;assert.equal(h.products.value[0].id,'B');assert.equal(h.error.value,'');assert.equal(h.busy.value,false);
});
