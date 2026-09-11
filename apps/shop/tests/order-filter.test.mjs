import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
function page() {
  const requests = [], hooks = {}, navigations = [];
  const fullSource = readFileSync(new URL("../src/pages/orders/index.vue", import.meta.url), "utf8");
  const source = fullSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const module = { exports: {} };
  const code = ts.transpileModule(source + "\nmodule.exports={load,select,status,orders,label,openProduct};", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error, uni: { navigateTo: value => navigations.push(value.url) }, require(name) {
    if (name === "vue") return { ref: value => ({ value }) };
    if (name === "@dcloudio/uni-app") return Object.fromEntries(["onLoad", "onShow", "onHide", "onUnload"].map(event => [event, fn => hooks[event] = fn]));
    if (name === "../../api") return { api: async path => { requests.push(path); return [{ id: "returned-by-server" }]; } };
    if (name === "../../commerce-model" || name.endsWith(".vue")) return {};
    throw new Error("Unexpected import " + name);
  } });
  return { ...module.exports, requests, hooks, navigations, source, fullSource };
}
test("pending shipment and after-sale tabs use server-side groups, not an exact single status", async () => {
  const h = page();
  for (const [status, query] of [["WAITING_FULFILLMENT", "group=pending_shipment"], ["AFTER_SALE", "group=after_sales"], ["PENDING_PAYMENT", "status=PENDING_PAYMENT"], ["SHIPPED", "status=SHIPPED"], ["", "status="]]) {
    h.status.value = status; await h.load();
    assert.equal(h.requests.at(-1), "/storefront/orders?" + query);
    assert.equal(h.orders.value[0].id, "returned-by-server");
  }
});
test("old My shortcuts and explicit new group links select the same complete query", async () => {
  for (const [options, status, group] of [[{ status: "AFTER_SALE" }, "AFTER_SALE", "after_sales"], [{ group: "after_sales" }, "AFTER_SALE", "after_sales"], [{ group: "pending_shipment" }, "WAITING_FULFILLMENT", "pending_shipment"]]) {
    const h = page(); h.hooks.onLoad(options); await h.hooks.onShow();
    assert.equal(h.status.value, status); assert.equal(h.requests[0], "/storefront/orders?group=" + group);
  }
});
test("completed orders display Chinese while unknown server states remain explicit", () => {
  const h = page(); assert.equal(h.label("COMPLETED"), "已完成"); assert.equal(h.label("RECEIVED"), "已完成"); assert.equal(h.label("FUTURE_STATUS"), "FUTURE_STATUS");
});
test("order-list product images route to product details instead of the order drawer", () => {
  const h = page(); h.openProduct({ productId: "product-a" });
  assert.deepEqual(h.navigations, ["/pages/product/index?id=product-a"]); assert.match(h.fullSource, /class="product-link"[\s\S]*?@click\.stop="openProduct\(item\)"/);
});
