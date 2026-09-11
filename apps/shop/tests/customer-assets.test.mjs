import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
function page(name,api){
  const hooks={},calls=[],notices=[];let session='first';
  const source=readFileSync(new URL(`../src/pages/${name}/index.vue`,import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const exported={coupons:'load,select,mode,rows,visibleRows,state,claim,claiming,busy,error,hasMore',points:'load,data,items,busy,error,openOrder',favorites:'load,products,busy,error,remove,removing'}[name];
  const module={exports:{}};
  const code=ts.transpileModule(source+`\nmodule.exports={${exported}};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,Error,Date,uni:{navigateTo:x=>calls.push(x),switchTab:x=>calls.push(x)},require(path){
    if(path==='vue')return {ref:value=>({value}),computed:fn=>({get value(){return fn();}})};
    if(path==='@dcloudio/uni-app')return {onShow:fn=>hooks.show=fn,onHide:fn=>hooks.hide=fn};
    if(path==='../../api')return {api:(...args)=>{calls.push(args);return api(...args);},mallSessionStamp:()=>session,money:x=>String(x),toast:x=>notices.push(x)};
    if(path.endsWith('.vue'))return {};throw Error('Unexpected import '+path);
  }});
  return {...module.exports,hooks,calls,notices,switchAccount(){session='second';}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const owned=(id,extra={})=>({id,coupon:{status:'ACTIVE',validFrom:'2020-01-01',validUntil:'2099-01-01'},...extra});
test('coupons preserve owned array and separate used/expired from usable',async()=>{
  const h=page('coupons',async()=>[owned('usable'),owned('used',{usedAt:'2026-01-01'}),owned('expired',{coupon:{status:'ACTIVE',validUntil:'2020-01-01'}})]);
  await h.load();assert.equal(h.visibleRows.value[0].id,'usable');h.mode.value='used';assert.equal(h.visibleRows.value[0].id,'used');h.mode.value='expired';assert.equal(h.visibleRows.value[0].id,'expired');
});
test('coupon center loads real endpoint and pages; stale owned response cannot replace it',async()=>{
  const old=deferred();const h=page('coupons',path=>path==='/storefront/coupons'?old.promise:Promise.resolve({items:[{id:path}],pagination:{hasMore:true}}));
  const pending=h.load();h.mode.value='available';await h.load();old.resolve([owned('old')]);await pending;
  assert.equal(h.rows.value[0].id,'/storefront/coupons/available?page=1');await h.load(true);assert.equal(h.rows.value[1].id,'/storefront/coupons/available?page=2');
});
test('claim double click calls once; success marks actual row claimed',async()=>{
  const request=deferred(),h=page('coupons',()=>request.promise),row={id:'coupon',available:true,claimed:false};
  const first=h.claim(row);await h.claim(row);assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].method,'POST');request.resolve({id:'claim'});await first;assert.equal(row.claimed,true);assert.equal(h.claiming.value,'');
});
test('unavailable and already owned coupons cannot be claimed',async()=>{
  const h=page('coupons',()=>{throw Error('should not request');});await h.claim({claimed:true,available:true});await h.claim({claimed:false,available:false});assert.equal(h.calls.length,0);
});
test('coupon hide/account switch rejects pending private data',async()=>{
  const late=deferred(),h=page('coupons',()=>late.promise);const pending=h.load();h.hooks.hide();h.switchAccount();late.resolve([owned('other')]);await pending;assert.equal(h.rows.value.length,0);
});
test('points unknown stays null, failed load retains retry state rather than invented zero',async()=>{
  let fail=true;const h=page('points',async()=>{if(fail)throw Error('network unavailable');return {verified:false,balanceCents:null,items:[],pagination:{hasMore:false}};});
  await h.load();assert.equal(h.data.value,undefined);assert.equal(h.error.value,'network unavailable');fail=false;await h.load();assert.equal(h.data.value.balanceCents,null);assert.equal(h.data.value.verified,false);assert.equal(h.error.value,'');
});
test('points failed second page retries page two without duplicate first page',async()=>{
  let fail=false;const h=page('points',async path=>{if(fail)throw Error('offline');return {verified:true,balanceCents:10,items:[{id:path}],pagination:{hasMore:true}};});
  await h.load();fail=true;await h.load(true);assert.equal(h.items.value.length,1);fail=false;await h.load(true);assert.equal(h.items.value.length,2);assert.match(h.calls.at(-1)[0],/page=2/);
});
test('points hidden response cannot resurrect prior balance or ledger',async()=>{
  const late=deferred(),h=page('points',()=>late.promise);const pending=h.load();h.hooks.hide();late.resolve({verified:true,balanceCents:9999,items:[{id:'old'}]});await pending;assert.equal(h.data.value,undefined);assert.equal(h.items.value.length,0);
});
test('favorite removal uses owned session and updates list only after server success',async()=>{
  const late=deferred(),h=page('favorites',path=>path==='/storefront/favorites'?Promise.resolve([{id:'p'}]):late.promise);await h.load();const pending=h.remove('p');await h.remove('p');assert.equal(h.products.value.length,1);assert.equal(h.calls.length,2);assert.equal(h.calls[1][1].data.enabled,false);late.resolve({ok:true});await pending;assert.equal(h.products.value.length,0);
});
test('favorites errors are not shown as an empty successful list and can retry',async()=>{
  let fail=true;const h=page('favorites',async()=>{if(fail)throw Error('connection lost');return [{id:'p'}];});await h.load();assert.equal(h.error.value,'connection lost');fail=false;await h.load();assert.equal(h.error.value,'');assert.equal(h.products.value.length,1);
});
