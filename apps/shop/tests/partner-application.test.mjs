import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url),
  ts = require("typescript"),
  vue = require("vue");
const { parse, compileScript } = require("vue/compiler-sfc");
function fixture(handler) {
  const file = new URL("../src/pages/partner/index.vue", import.meta.url),
    descriptor = parse(readFileSync(file, "utf8"), {
      filename: file.pathname,
    }).descriptor;
  const source = compileScript(descriptor, {
    id: "partner-application",
  }).content;
  const module = { exports: {} },
    requests = [],
    hooks = {};
  const imports = {
    vue,
    "@dcloudio/uni-app": {
      onLoad: (fn) => (hooks.load = fn),
      onShow: (fn) => (hooks.show = fn),
    },
    "../../realm": { mallStorage: { get: () => "local-member-session" } },
    "../../api": {
      api: async (path, input) => {
        requests.push({ path, input });
        return handler(path, input);
      },
    },
    "../../components/DesktopHeader.vue": {},
  };
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
      Error,
      Date,
      uni: {},
      require: (path) => {
        assert.ok(path in imports, path);
        return imports[path];
      },
    },
  );
  const ui = module.exports.default.setup({}, { expose() {} });
  Object.assign(ui.form, {
    name: "本地测试门店",
    contactName: "测试联系人",
    mobile: "13800138000",
    region: "测试地区",
    description: "仅本地流程验收",
  });
  return { ui, requests, hooks };
}
test("application validates missing fields before requesting and gives a visible error", async () => {
  const h = fixture(() => assert.fail("no request expected"));
  h.ui.form.name = " ";
  await h.ui.submit();
  assert.match(h.ui.error.value, /完整/);
  assert.equal(h.requests.length, 0);
});
test("application submission is single flight and immediately shows the returned pending record", async () => {
  let resolve;
  const pending = new Promise((r) => (resolve = r));
  const h = fixture((path) =>
    path === "/partner/applications"
      ? pending
      : Promise.reject(new Error("刷新暂时失败")),
  );
  const first = h.ui.submit();
  await h.ui.submit();
  assert.equal(h.requests.length, 1);
  resolve({ id: "local-application", status: "PENDING" });
  await first;
  assert.equal(h.ui.status.value.application.id, "local-application");
  assert.equal(h.ui.status.value.application.status, "PENDING");
  assert.match(h.ui.error.value, /刷新暂时失败/);
  assert.equal(h.ui.busy.value, false);
});
test("uncertain network result keeps the idempotency key on retry", async () => {
  let attempt = 0;
  const h = fixture((path) => {
    if (path === "/partner/status")
      return { partner: null, application: { status: "PENDING" } };
    if (!attempt++) throw new Error("网络中断");
    return { status: "PENDING" };
  });
  await h.ui.submit();
  assert.match(h.ui.error.value, /网络/);
  await h.ui.submit();
  const writes = h.requests.filter((r) => r.input?.method === "POST");
  assert.equal(writes.length, 2);
  assert.equal(
    writes[0].input.data.idempotencyKey,
    writes[1].input.data.idempotencyKey,
  );
  assert.equal(writes[0].input.auth, true);
  assert.equal(h.ui.status.value.application.status, "PENDING");
});
