import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const ts = createRequire(import.meta.url)("typescript");
function fixture() {
  const storage = new Map(), requests = [];
  const context = { exports: {}, URL, Date, JSON, Error, encodeURIComponent,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    location: { href: "http://localhost/saidian-mall/?partner=partner-first#/pages/login/index" },
    history: { state: null, replaceState: (_state, _title, url) => { context.location.href = String(url); } },
    fetch: async (url, options) => { requests.push({ url, options }); if (context.failed) return { ok: false, json: async () => ({}) }; const code = decodeURIComponent(url.split('/').at(-1)); return { ok: true, json: async () => ({ data: { partnerCode: code, name: '合成伙伴', notice: '合成共享告知' } }) }; },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/partner-referral.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { module: context.exports, context, requests, storage };
}
test('first server-validated partner source survives refresh/OAuth and a later QR', async () => { const h = fixture(); const first = await h.module.loadPartnerReferral(); assert.equal(first.code, 'partner-first'); h.context.location.href = 'http://localhost/saidian-mall/?partner=partner-second'; assert.equal((await h.module.loadPartnerReferral()).code, 'partner-first'); assert.equal(h.requests.length, 2); assert.equal(h.requests[1].url.endsWith('/partner-first'), true); });
test('invalid/disabled partner is not stored or silently converted to ordinary registration', async () => { const h = fixture(); h.context.failed = true; await assert.rejects(h.module.loadPartnerReferral(), /失效/); assert.equal(h.module.currentPartnerReferral(), null); assert.equal(h.module.attemptedPartnerCode(), 'partner-first'); });
test('explicit ordinary registration clears both stored source and URL source', async () => { const h = fixture(); await h.module.loadPartnerReferral(); h.module.clearPartnerReferral(); assert.equal(h.module.currentPartnerReferral(), null); assert.equal(h.module.attemptedPartnerCode(), null); assert.equal(new URL(h.context.location.href).searchParams.has('partner'), false); });
test('normal login has no partner network requests', async () => { const h = fixture(); h.context.location.href = 'http://localhost/saidian-mall/'; assert.equal(await h.module.loadPartnerReferral(), null); assert.equal(h.requests.length, 0); });
