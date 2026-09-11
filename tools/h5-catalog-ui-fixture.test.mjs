import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { createCatalogFixture, catalogApi, catalogBase, catalogControlScript } from "./h5-catalog-ui-fixture.mjs";

// Only localhost HTTP against the fixture; no database or external provider calls.
test("global catalog fixture preserves read-only realm and safe one-shot UI controls", async t => {
  const server = await createCatalogFixture();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const get = (path, options = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, ...options }, res => {
      let body = ""; res.on("data", part => body += part); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body) }));
    }); req.on("error", reject); req.end(options.body);
  });
  const control = await get("/fixture/");
  assert.equal(control.status, 200); assert.match(control.body, /30 个合成商品/);
  assert.match(control.body, /type="submit" name="action"/); assert.match(control.body, /id="control-status" role="status"/);
  assert.equal((await get("/fixture/control.js")).body, catalogControlScript);
  const csrf = control.body.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const arm = action => get("/fixture/control", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action, csrf }).toString() });
  const caps = (await get(catalogApi + "/storefront/capabilities")).json();
  assert.equal(caps.realm, "global"); assert.equal(caps.checkout.enabled, false); assert.deepEqual(caps.payments, []);
  const list = query => get(catalogApi + "/storefront/products?" + query);
  const a = (await list("keyword=A&pageSize=24&page=1")).json(), a2 = (await list("keyword=A&pageSize=24&page=2")).json();
  assert.equal(a.total, 27); assert.equal(a.items.length, 24); assert.equal(a2.items.length, 3);
  assert.equal(new Set([...a.items, ...a2.items].map(x => x.id)).size, 27);
  const b = (await list("keyword=B&pageSize=24&page=1")).json(); assert.equal(b.total, 3); assert.equal(b.items.length, 3);
  assert.equal((await list("categoryId=fixture-accessory")).json().total, 3);
  assert.equal((await list("page=0")).status, 400);
  assert.equal((await arm("products")).status, 303);
  assert.equal((await list("keyword=A")).status, 503); assert.equal((await list("keyword=A")).status, 200);
  assert.equal((await arm("bootstrap")).status, 303);
  assert.equal((await get(catalogApi + "/storefront/bootstrap")).status, 503);
  const boot = (await get(catalogApi + "/storefront/bootstrap")).json(); assert.equal(boot.categories.length, 2); assert.equal(boot.featured.length, 6);
  const detail = (await get(catalogApi + "/storefront/products/" + a.items[0].id)).json();
  assert.equal(detail.skus.length, 1); assert.ok(detail.coverImage.startsWith("/fixture/"));
  assert.equal((await get(detail.coverImage)).status, 200);
  const index = await get(catalogBase); assert.equal(index.status, 200); assert.match(index.headers["content-security-policy"], /connect-src 'self'/);
  assert.match(index.headers["content-security-policy"], /img-src 'self' data: blob:/);
  assert.equal((await get("/fixture/", { headers: { host: "evil.example:" + port } })).status, 403);
  for (const path of [catalogBase + "../package.json", catalogBase + "%2e%2e/package.json", catalogBase + "%252e%252e/package.json", catalogBase + "%5c..%5cpackage.json"]) assert.equal((await get(path)).status, 400);
  assert.equal((await get(catalogApi + "/storefront/orders", { method: "POST" })).status, 403);
  assert.equal((await get("/fixture/control", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "action=products&csrf=invalid" })).status, 403);
  assert.equal((await get("/fixture/control", { method: "POST", headers: { origin: "https://external.example", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action: "products", csrf }).toString() })).status, 403);
  const fetchControl = await get("/fixture/control", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", origin: `http://127.0.0.1:${port}` }, body: new URLSearchParams({ action: "clear", csrf }).toString() });
  assert.equal(fetchControl.status, 200); assert.deepEqual(fetchControl.json().pending, { products: false, bootstrap: false });
  const evidence = (await get("/fixture/evidence")).json();
  assert.equal(evidence.externalCalls, 0); assert.equal(evidence.productsFailures, 1); assert.equal(evidence.bootstrapFailures, 1);
  assert.equal(evidence.controlsAccepted, 3); assert.equal(evidence.controlsReceived, 5); assert.deepEqual(evidence.controlRejections, ["csrf", "origin"]);
  assert.equal(evidence.requests[1].page, 2); assert.equal(evidence.requests[1].keyword, "A");
  assert.doesNotMatch(JSON.stringify(evidence), /token|password|secret/i);
});

test("control-page submit handler sends same-origin protected request and renders success or rejection", async () => {
  for (const ok of [true, false]) {
    let handler, prevented = false, calls = 0;
    const elements = { "control-status": { textContent: "" }, "products-state": { textContent: "关闭" }, "bootstrap-state": { textContent: "关闭" } };
    const buttons = [{ disabled: false }, { disabled: false }];
    const form = { addEventListener: (event, listener) => { assert.equal(event, "submit"); handler = listener; }, querySelectorAll: () => buttons, querySelector: () => ({ value: "fixture-test-csrf" }) };
    runInNewContext(catalogControlScript, {
      document: { querySelector: () => form, getElementById: id => elements[id] }, URLSearchParams,
      fetch: async (path, options) => {
        calls++; assert.equal(path, "/fixture/control"); assert.equal(options.method, "POST"); assert.equal(options.mode, "same-origin");
        assert.equal(options.headers.accept, "application/json"); assert.equal(options.body.get("csrf"), "fixture-test-csrf"); assert.equal(options.body.get("action"), "products");
        assert.ok(buttons.every(button => button.disabled));
        return { ok, json: async () => ok ? { pending: { products: true, bootstrap: false } } : { message: "本地控制被拒绝：csrf" } };
      },
    });
    await handler({ preventDefault: () => { prevented = true; }, submitter: { value: "products" } });
    assert.equal(calls, 1); assert.equal(prevented, true); assert.ok(buttons.every(button => !button.disabled));
    assert.match(elements["control-status"].textContent, ok ? /控制已生效/ : /控制未生效.*csrf/);
    assert.equal(elements["products-state"].textContent, ok ? "已开启一次" : "关闭");
  }
});
