import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
const require = createRequire(import.meta.url),
  ts = require("typescript"),
  vue = require("vue");
const { parse, compileScript, compileTemplate } = require("vue/compiler-sfc");
function evaluate(source, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      Date,
      Error,
      crypto: webcrypto,
      setInterval,
      clearInterval,
      ...globals,
      require(name) {
        assert.ok(Object.hasOwn(imports, name), name);
        return imports[name];
      },
    },
  );
  return module.exports;
}
function compile(path, imports, globals = {}) {
  const filename = fileURLToPath(new URL("../src/" + path, import.meta.url));
  const descriptor = parse(readFileSync(filename, "utf8"), {
    filename,
  }).descriptor;
  const script = compileScript(descriptor, { id: "gift-flow" });
  const template = compileTemplate({
    source: descriptor.template.content,
    filename,
    id: "gift-flow",
    compilerOptions: {
      bindingMetadata: script.bindings,
      isCustomElement: (name) => name === name.toLowerCase(),
    },
  });
  assert.deepEqual(template.errors, []);
  return {
    component: evaluate(script.content, imports, globals).default,
    render: evaluate(template.code, {
      vue: { ...vue, withDirectives: (node) => node },
    }).render,
  };
}
const helper = evaluate(
  readFileSync(new URL("../src/gift-redemption.ts", import.meta.url), "utf8"),
  {},
);
const detailStub = { name: "GiftProductDetails", render: () => null },
  descriptionStub = { render: () => null },
  imageStub = { render: () => null };
const token = "a".repeat(43);
function nodes(node) {
  return !node || typeof node !== "object"
    ? []
    : [
        node,
        ...(Array.isArray(node.children) ? node.children.flatMap(nodes) : []),
      ];
}
function text(node) {
  return typeof node?.children === "string"
    ? node.children
    : Array.isArray(node?.children)
      ? node.children.map(text).join("")
      : "";
}
function button(tree, label) {
  return nodes(tree).find(
    (node) => node.type === "button" && text(node).includes(label),
  );
}
async function page(skus) {
  const hooks = {},
    requests = [],
    local = new Map(),
    draft = new Map();
  local.set("saidian-user", { id: "member" });
  const product = {
    id: "product",
    name: "合成礼品",
    coverImage: "/synthetic.webp",
    skus,
  };
  const quote = {
    sku: {
      id: skus[0].id,
      name: product.name,
      specification: "合成规格",
      priceCents: 68000,
      estimatedDispatchDays: 7,
    },
    address: {
      id: "address",
      name: "合成收货人",
      mobile: "13900000001",
      province: "广东省",
      city: "深圳市",
      detail: "合成地址",
    },
    giftDiscountCents: 68000,
    fingerprint: "b".repeat(64),
  };
  const { component, render } = compile(
    "pages/gift-redemption/index.vue",
    {
      vue: { ...vue, onBeforeUnmount: (cb) => (hooks.unmount = cb) },
      "@dcloudio/uni-app": {
        onLoad: (cb) => (hooks.load = cb),
        onShow: (cb) => (hooks.show = cb),
      },
      "../../api": {
        api: async (path, input) => {
          requests.push({ path, input });
          if (path.endsWith("/capabilities")) return { enabled: true };
          if (path.endsWith("/validate"))
            return {
              token,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              product,
              card: {},
              consentVersion: "synthetic-v1",
            };
          if (path.endsWith("/preview")) return quote;
          if (path.endsWith("/submit"))
            return { orderId: "order", orderNo: "SYNTHETIC" };
          throw Error(path);
        },
        mallSessionStamp: () => "session",
        money: (v) => "¥" + (v / 100).toFixed(2),
        toast() {},
        saveMallSession() {},
      },
      "../../realm": { mallStorage: { get: (key) => local.get(key) } },
      "../../gift-redemption": helper,
      "../../components/DesktopHeader.vue": { default: { render: () => null } },
      "../../components/CatalogImage.vue": { default: imageStub },
      "../../components/GiftProductDetails.vue": { default: detailStub },
    },
    {
      sessionStorage: {
        getItem: (key) => draft.get(key),
        setItem: (key, value) => draft.set(key, value),
        removeItem: (key) => draft.delete(key),
      },
      uni: { showToast() {} },
    },
  );
  const state = component.setup({}, { expose() {} }),
    ui = vue.proxyRefs(state);
  await hooks.load({});
  await state.validateCard();
  return {
    state,
    requests,
    quote,
    hooks,
    tree: () => render({}, [], {}, ui, {}, {}),
  };
}
test("ERP backorder remains selectable and single available zero-stock gift advances", async () => {
  const h = await page([
    {
      id: "erp",
      specification: "未来银 / 8号",
      stock: 0,
      redeemable: true,
      estimatedDispatchDays: 7,
    },
  ]);
  assert.equal(h.state.skuId.value, "erp");
  const tree = h.tree(),
    option = button(tree, "未来银");
  assert.equal(option.props.disabled, false);
  assert.match(text(option), /✓ 已选/);
  assert.doesNotMatch(text(option), /预计/);
  const rendered = nodes(tree);
  const dispatch = rendered.find((node) => node.props?.role === "status");
  assert.equal(text(dispatch), "预计7天发货");
  assert.ok(rendered.indexOf(dispatch) > rendered.indexOf(option));
  assert.ok(
    rendered.indexOf(dispatch) < rendered.indexOf(button(tree, "下一步")),
  );
  assert.doesNotMatch(text(h.tree()), /当前规格暂时缺货/);
  await button(h.tree(), "下一步").props.onClick();
  assert.equal(h.state.stage.value, "phone");
});
test("one dispatch estimate follows the selected SKU without enabling a LOCAL shortage", async () => {
  const h = await page([
    {
      id: "erp",
      specification: "ERP预订",
      stock: -3,
      redeemable: true,
      estimatedDispatchDays: 7,
    },
    {
      id: "stock",
      specification: "现货",
      stock: 2,
      redeemable: true,
      estimatedDispatchDays: 2,
    },
    {
      id: "local",
      specification: "本地缺货",
      stock: 0,
      redeemable: false,
      estimatedDispatchDays: 7,
    },
  ]);
  assert.equal(button(h.tree(), "ERP预订").props.disabled, false);
  assert.doesNotMatch(text(h.tree()), /预计[27]天发货/);
  await button(h.tree(), "ERP预订").props.onClick();
  assert.equal(
    text(nodes(h.tree()).find((node) => node.props?.role === "status")),
    "预计7天发货",
  );
  await button(h.tree(), "现货").props.onClick();
  assert.equal(
    text(nodes(h.tree()).find((node) => node.props?.role === "status")),
    "预计2天发货",
  );
  assert.doesNotMatch(text(h.tree()), /预计7天发货/);
  assert.doesNotMatch(text(button(h.tree(), "现货")), /预计/);
  assert.equal(button(h.tree(), "本地缺货").props.disabled, true);
});
for (const dispatchDays of [2, 7])
  test(`confirmation uses server ${dispatchDays}-day estimate and only warns for a backorder`, async () => {
    const h = await page([
      {
        id: "stock",
        specification: "现货",
        stock: 2,
        redeemable: true,
        estimatedDispatchDays: 2,
      },
    ]);
    h.quote.sku.estimatedDispatchDays = dispatchDays;
    h.state.verified.value = true;
    h.state.ownerId.value = "member";
    h.state.addressId.value = "address";
    await h.state.prepare();
    assert.equal(h.state.stage.value, "confirm");
    assert.ok(text(h.tree()).includes(`预计${dispatchDays}天发货`));
    assert.equal(
      text(h.tree()).includes("个性定制产品，发货时长稍长，请耐心等待。"),
      dispatchDays === 7,
    );
    assert.equal(
      h.requests.filter((row) => row.path.endsWith("/submit")).length,
      0,
    );
    await button(h.tree(), "确认兑换 · 免费包邮").props.onClick();
    assert.equal(
      h.requests.filter((row) => row.path.endsWith("/submit")).length,
      1,
    );
  });
test("product title and image open the same detail dialog without resetting or submitting", async () => {
  const h = await page([
    {
      id: "erp",
      specification: "预订",
      stock: 0,
      redeemable: true,
      estimatedDispatchDays: 7,
    },
  ]);
  await button(h.tree(), "合成礼品").props.onClick();
  const popup = nodes(h.tree()).find((node) => node.type === detailStub);
  assert.equal(popup.props["product-id"], "product");
  popup.props.onClose();
  const image = nodes(h.tree()).find((node) => node.type === imageStub);
  assert.equal(image.props.role, "button");
  image.props.onClick();
  assert.equal(h.state.productDetailsVisible.value, true);
  const imagePopup = nodes(h.tree()).find((node) => node.type === detailStub);
  assert.equal(imagePopup.props["product-id"], "product");
  imagePopup.props.onClose();
  assert.equal(h.state.productDetailsVisible.value, false);
  assert.equal(h.state.skuId.value, "erp");
  assert.equal(h.state.token.value, token);
  assert.equal(
    h.requests.filter((row) => row.path.endsWith("/submit")).length,
    0,
  );
});
const tick = () => new Promise(setImmediate);
async function details(request) {
  const hooks = {},
    calls = [],
    events = [];
  const { component, render } = compile("components/GiftProductDetails.vue", {
    vue: {
      ...vue,
      onMounted: (cb) => (hooks.mount = cb),
      onBeforeUnmount: (cb) => (hooks.unmount = cb),
    },
    "../api": {
      api: async (path) => {
        calls.push(path);
        return request();
      },
    },
    "./CatalogImage.vue": { default: imageStub },
    "./ProductDescription.vue": { default: descriptionStub },
  });
  const state = component.setup(
      vue.reactive({ productId: "product-id", title: "合成礼品" }),
      { expose() {}, emit: (event) => events.push(event) },
    ),
    ui = vue.proxyRefs(state);
  await tick();
  return {
    state,
    calls,
    events,
    hooks,
    tree: () => render({}, [], {}, ui, {}, {}),
  };
}
test("detail popup uses the corresponding storefront HTML renderer and retries without leaving the flow", async () => {
  let fail = true;
  const html = "<p>对应商品详情</p>",
    h = await details(() => {
      if (fail) throw Error("synthetic network");
      return {
        id: "product-id",
        detailHtml: html,
        coverImage: "/synthetic.webp",
        gallery: [],
      };
    });
  assert.match(text(h.tree()), /暂时无法加载/);
  fail = false;
  await button(h.tree(), "重新加载").props.onClick();
  assert.equal(
    nodes(h.tree()).find((node) => node.type === descriptionStub).props.html,
    html,
  );
  assert.deepEqual(h.calls, [
    "/storefront/products/product-id",
    "/storefront/products/product-id",
  ]);
  h.state.onKeydown({ key: "Escape", preventDefault() {} });
  assert.deepEqual(h.events, ["close"]);
});
test("closing a detail popup prevents a late response from overwriting its state", async () => {
  let resolve;
  const h = await details(() => new Promise((done) => (resolve = done)));
  h.hooks.unmount();
  resolve({ id: "product-id", detailHtml: "late" });
  await tick();
  assert.equal(h.state.product.value, null);
});
