import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ts=createRequire(import.meta.url)("typescript");
function load(name){const source=readFileSync(new URL('../src/'+name+'.ts',import.meta.url),'utf8'), module={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date,JSON});return module.exports;}
test('gift recovery keeps the original request and never includes a raw card check code',()=>{
  const helper=load('gift-redemption'), values=new Map(), store={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const token='a'.repeat(43),draft={token,expiresAt:new Date(Date.now()+60000).toISOString(),ownerId:'member-1',skuId:'sku-1',addressId:'address-1',request:{token,skuId:'sku-1',addressId:'address-1',fingerprint:'b'.repeat(64),requestKey:'original-order-key'}};
  helper.saveGiftDraft(store,draft);const restored=helper.readGiftDraft(store);
  assert.equal(restored.request.requestKey,'original-order-key');assert.equal(restored.request.fingerprint,draft.request.fingerprint);
  assert.ok(![...values.values()].some(value=>value.includes('checkCode')));
  helper.saveGiftDraft(store,null);assert.equal(helper.readGiftDraft(store),null);
});
test('expired or corrupted gift recovery does not generate a replacement order request',()=>{
  const helper=load('gift-redemption');assert.equal(helper.readGiftDraft({getItem:()=>'{broken'}),null);
  const draft={token:'a'.repeat(43),expiresAt:new Date(0).toISOString(),ownerId:'member-1',skuId:'sku',addressId:'address'};
  assert.equal(helper.readGiftDraft({getItem:()=>JSON.stringify(draft)}),null);
  draft.expiresAt=new Date(Date.now()+60000).toISOString();draft.request={token:draft.token,skuId:'different',addressId:'address',fingerprint:'b'.repeat(64),requestKey:'request-1'};
  assert.equal(helper.readGiftDraft({getItem:()=>JSON.stringify(draft)}),null);
});
test('gift H5 routes allow only the intended read or write methods',()=>{
  const realm=load('realm-config');assert.equal(realm.globalPageAllowed('/pages/gift-redemption/index?cardNo=81200035'),true);
  for(const endpoint of ['validate','session','sms/request','sms/verify','preview','submit','result']){assert.equal(realm.globalApiAllowed('/storefront/gift-redemptions/'+endpoint,'POST'),true);assert.equal(realm.globalApiAllowed('/storefront/gift-redemptions/'+endpoint,'GET'),false);}
  assert.equal(realm.globalApiAllowed('/storefront/gift-redemptions/capabilities','GET'),true);assert.equal(realm.globalApiAllowed('/storefront/gift-redemptions/submit?token=secret','POST'),false);
});
