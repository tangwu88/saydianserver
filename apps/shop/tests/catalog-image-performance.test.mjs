import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url), ts = require("typescript");
function evaluate(name, imports = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, ...globals, require: name => { assert.ok(Object.hasOwn(imports, name)); return imports[name]; },
  });
  return module.exports;
}
const catalog = evaluate("catalog-image");
const source = "https://app.saydian.cn/api/saydian-app/v2/files/5dacdf96-6389-45bf-bc68-3fb2ac95ead1";

test("image sizing only rewrites exact public file routes, preserving third-party and signed URLs", () => {
  assert.equal(catalog.catalogImageSource(source, 480), source + "/image?width=480");
  assert.equal(catalog.catalogImageSource(source.replace("/api/", "/global/api/"), 960), source.replace("/api/", "/global/api/") + "/image?width=960");
  for (const url of ["https://other.invalid/a.jpg", source + "?signature=synthetic", source + "#fragment", source.replace("app.saydian.cn", "app.saydian.cn.evil.invalid"), "/api/saydian-app/v2/files/../private", "/static/cover.webp"])
    assert.equal(catalog.catalogImageSource(url, 480), url);
  assert.equal(catalog.catalogImageSet("/static/cover.webp"), undefined);
  assert.match(catalog.catalogImageSet(source), /width=480 480w, .*width=960 960w, .*width=1440 1440w/);
});

function harness(observerAvailable = true) {
  let observer;
  class Observer {
    targets = new Set(); disconnected = false;
    constructor(callback, options) { this.callback = callback; this.options = options; observer = this; }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    intersect(target) { this.callback([{ target, isIntersecting: true }]); }
  }
  const api = evaluate("deferred-product-images", { "./catalog-image": catalog }, observerAvailable ? { IntersectionObserver: Observer } : {});
  return { ...api, observer: () => observer };
}
class Image {
  constructor(alt) { this.alt = alt; this.dataset = {}; this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.complete = true; this.naturalWidth = 800; }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(key, callback) { this.listeners.set(key, callback); }
  removeEventListener(key) { this.listeners.delete(key); }
  dispatch(key, event = {}) { this.listeners.get(key)?.(event); }
}

test("description markup initially contains inert placeholders and no downloadable product URLs", () => {
  const h = harness(), prepared = h.prepareProductDescription(`<p>商品介绍</p><IMG src="${source}" alt="说明 > 图" width="1600" height="3000" onerror="bad()" srcset="https://other.invalid/eager.jpg 2x"><img src='https://other.invalid/detail.jpg'>`);
  assert.equal(prepared.images.length, 2);
  assert.equal(prepared.images[0].original, source); assert.equal(prepared.images[0].alt, "说明 > 图");
  assert.match(prepared.html, /商品介绍/); assert.match(prepared.html, /data:image\/gif;base64/);
  assert.match(prepared.html, /aspect-ratio:1600\/3000/);
  assert.doesNotMatch(prepared.html, /app\.saydian\.cn|other\.invalid|onerror|srcset/);
  assert.equal(h.prepareProductDescription(null).html, "");
  assert.equal(h.prepareProductDescription('<img src="javascript:bad()"><img src="file:///private.png"><img src="data:image/svg+xml;base64,PHN2Zz4=">').images.length, 0);
});

test("CDN, relative and embedded raster details keep working without an arbitrary image proxy", () => {
  const h = harness(), prepared = h.prepareProductDescription('<img src="//cdn.example.invalid/detail.jpg"><img src="images/detail.png"><img src="../detail.webp"><img src="data:image/png;base64,aGVsbG8=">');
  assert.deepEqual(Array.from(prepared.images, image => image.original), ['https://cdn.example.invalid/detail.jpg', 'images/detail.png', '../detail.webp', 'data:image/png;base64,aGVsbG8=']);
  assert.equal(prepared.images[0].source, prepared.images[0].original);
  assert.equal(prepared.images[1].source, prepared.images[1].original);
});

test("only images near the viewport begin network loading, with reserved placeholder height", () => {
  const h = harness(), prepared = h.prepareProductDescription(`<img src="${source}"><img src="https://other.invalid/detail.jpg">`);
  const first = new Image(prepared.images[0].marker), second = new Image(prepared.images[1].marker), unrelated = new Image("other");
  const dispose = h.attachDeferredProductImages({ querySelectorAll: () => [first, second, unrelated] }, prepared.images);
  assert.equal(first.getAttribute("src"), null); assert.equal(second.getAttribute("src"), null);
  assert.equal(first.style.minHeight, "320px"); assert.equal(h.observer().options.rootMargin, "320px 0px");
  first.dispatch("load"); second.dispatch("error");
  assert.equal(first.style.minHeight, "320px"); assert.equal(second.getAttribute("src"), null);
  h.observer().intersect(first);
  assert.equal(first.getAttribute("src"), source + "/image?width=960"); assert.equal(second.getAttribute("src"), null);
  assert.equal(h.observer().targets.size, 1); assert.equal(first.decoding, "async");
  first.dispatch("load"); assert.equal(first.style.minHeight, "");
  dispose(); assert.equal(h.observer().disconnected, true); assert.equal(first.listeners.size, 0);
  h.observer().intersect(second); assert.equal(second.getAttribute("src"), null);
});

test("failed optimized images fall back once to the original and offer an accessible retry", () => {
  const h = harness(), prepared = h.prepareProductDescription(`<img src="${source}" alt="详情图">`), image = new Image(prepared.images[0].marker);
  h.attachDeferredProductImages({ querySelectorAll: () => [image] }, prepared.images); h.observer().intersect(image);
  image.dispatch("error"); assert.equal(image.getAttribute("src"), source);
  image.dispatch("error"); assert.equal(image.getAttribute("role"), "button"); assert.equal(image.tabIndex, 0);
  let prevented = false; image.dispatch("keydown", { key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(image.getAttribute("src"), source + "/image?width=960");
  image.dispatch("load"); assert.equal(image.alt, "详情图"); assert.equal(image.hasAttribute("data-image-failed"), false); assert.equal(image.hasAttribute("role"), false);
});

test("older browsers without IntersectionObserver remain usable with native lazy loading", () => {
  const h = harness(false), prepared = h.prepareProductDescription(`<img src="${source}">`), image = new Image(prepared.images[0].marker);
  h.attachDeferredProductImages({ querySelectorAll: () => [image] }, prepared.images);
  assert.equal(image.getAttribute("src"), source + "/image?width=960"); assert.equal(image.loading, "lazy");
});

test("wide desktop descriptions keep a larger rendition for readable text", () => {
  const h = harness(), prepared = h.prepareProductDescription(`<img src="${source}">`), image = new Image(prepared.images[0].marker);
  h.attachDeferredProductImages({ clientWidth: 1200, querySelectorAll: () => [image] }, prepared.images);
  h.observer().intersect(image); assert.equal(image.getAttribute("src"), source + "/image?width=1440");
});

test("legacy width/height hints cannot stretch an image after its real pixels load", () => {
  const h = harness(), prepared = h.prepareProductDescription(`<img src="${source}" width="100" height="1000">`), image = new Image(prepared.images[0].marker);
  image.style.aspectRatio = "100 / 1000";
  h.attachDeferredProductImages({ querySelectorAll: () => [image] }, prepared.images);
  assert.equal(image.style.aspectRatio, "100 / 1000");
  h.observer().intersect(image); image.dispatch("load");
  assert.equal(image.style.aspectRatio, "");
});

test("descriptions retain the existing rich-text security boundary", () => {
  const component = readFileSync(new URL("../src/components/ProductDescription.vue", import.meta.url), "utf8");
  assert.match(component, /<rich-text :nodes="prepared\.html"/);
  assert.doesNotMatch(component, /v-html|innerHTML/);
});

test("card images wait until near the viewport and activate only once", () => {
  let observer;
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; observer = this; }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  }
  const images = evaluate("catalog-image", {}, { IntersectionObserver: Observer });
  let activated = 0; const element = {};
  images.observeCatalogImage(element, () => activated++);
  assert.equal(activated, 0); assert.equal(observer.element, element);
  assert.equal(observer.options.rootMargin, "160px 0px");
  observer.callback([{ isIntersecting: false }]); assert.equal(activated, 0);
  observer.callback([{ isIntersecting: true }]); assert.equal(activated, 1);
  observer.callback([{ isIntersecting: true }]); assert.equal(activated, 1);
  assert.equal(observer.disconnected, true);
});

test("removed or changed card images ignore queued viewport callbacks", () => {
  let callback, disconnected = false, activated = false;
  class Observer { constructor(fn) { callback = fn; } observe() {} disconnect() { disconnected = true; } }
  const images = evaluate("catalog-image", {}, { IntersectionObserver: Observer });
  const dispose = images.observeCatalogImage({}, () => { activated = true; });
  dispose(); callback([{ isIntersecting: true }]);
  assert.equal(disconnected, true); assert.equal(activated, false);
});

test("card images remain usable without IntersectionObserver", () => {
  let activated = 0;
  const dispose = catalog.observeCatalogImage({}, () => activated++);
  assert.equal(activated, 1); dispose();
});
