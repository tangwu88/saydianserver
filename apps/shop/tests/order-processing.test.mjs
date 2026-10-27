import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(handler){
  const timers=[],requests=[],progress=[],applied=[],module={exports:{}};
  const source=readFileSync(new URL('../src/order-processing.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:id=>{const i=timers.indexOf(id);if(i>=0)timers.splice(i,1);}});
  let session='member-a',visible=true;
  const helper=module.exports.createOrderProcessing({request:async(path,input)=>{requests.push({path,input});return handler(path,input,requests.length);},current:ctx=>visible&&ctx.session===session,progress:value=>progress.push(value),apply:value=>applied.push(value)});
  return {helper,timers,requests,progress,applied,ctx:{id:'order-a',session:'member-a',screen:1},hide(){visible=false;helper.stop();},switch(){session='member-b';}};
}
test('member ERP polling rereads the full order after completion and carries the verified session',async()=>{
  const h=fixture((path,input,n)=>path.endsWith('/processing')?{state:n===1?'PENDING':'READY'}:{id:'order-a',status:'CANCELLED'});
  await h.helper.start(h.ctx);assert.equal(h.requests[0].input.method,'POST');assert.equal(h.timers.length,1);
  h.timers.shift()();await new Promise(setImmediate);
  assert.equal(h.requests[1].input.method,'GET');assert.equal(h.requests[2].path,'/storefront/orders/order-a');
  assert.equal(h.applied[0].status,'CANCELLED');assert.ok(h.requests.every(x=>x.input.sessionStamp==='member-a'));
});
test('account changes suppress an old processing result before rereading its order',async()=>{
  const wait=deferred(),h=fixture(()=>wait.promise);const run=h.helper.start(h.ctx);h.switch();wait.resolve({state:'READY'});await run;
  assert.equal(h.requests.length,1);assert.equal(h.applied.length,0);assert.equal(h.progress.length,0);
});
test('a hidden page cannot receive an order reread or leave a timer running',async()=>{
  const wait=deferred(),h=fixture(path=>path.endsWith('/processing')?{state:'READY'}:wait.promise);
  const run=h.helper.start(h.ctx);await new Promise(setImmediate);h.hide();wait.resolve({id:'order-a',status:'SHIPPED'});await run;
  assert.equal(h.applied.length,0);assert.equal(h.timers.length,0);
});
test('a newer refresh wins even if the old final reread finishes later',async()=>{
  const wait=deferred();let reads=0;const h=fixture(path=>path.endsWith('/processing')?{state:'READY'}:++reads===1?wait.promise:{id:'order-a',status:'CANCELLED'});
  const old=h.helper.start(h.ctx);await new Promise(setImmediate);await h.helper.start(h.ctx);wait.resolve({id:'order-a',status:'WAITING_FULFILLMENT'});await old;
  assert.equal(h.applied.length,1);assert.equal(h.applied[0].status,'CANCELLED');
});
test('polling is bounded and a failure retains the last order',async()=>{
  const h=fixture(()=>({state:'PENDING'}));await h.helper.start(h.ctx);
  for(let n=0;n<12;n++){h.timers.shift()();await new Promise(setImmediate);}
  assert.equal(h.requests.length,13);assert.equal(h.timers.length,0);assert.equal(h.progress.at(-1).state,'TIMEOUT');assert.equal(h.applied.length,0);
  const failed=fixture(()=>{throw Error('provider');});await failed.helper.start(failed.ctx);assert.equal(failed.progress.at(-1).state,'ERROR');assert.equal(failed.applied.length,0);
});
