import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript"), vue = require("vue");
const { parse, compileScript, compileTemplate } = require("vue/compiler-sfc");

function evaluate(source, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error, URL, ...globals,
    require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`); return imports[name]; },
  });
  return module.exports;
}

async function harness() {
  const url = new URL("../src/pages/help/index.vue", import.meta.url), filename = url.pathname;
  const descriptor = parse(readFileSync(url, "utf8"), { filename }).descriptor;
  const script = compileScript(descriptor, { id: "help-feedback-test" });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: "help-feedback-test", compilerOptions: {
    bindingMetadata: script.bindings, isCustomElement: tag => tag === tag.toLowerCase(),
  } });
  assert.deepEqual(template.errors, []);
  const hooks = {}, requests = [], notices = [], logins = [];
  let rows = [{
    id: "feedback-1", category: "shopping", content: "测试订单未能付款", status: "resolved",
    replyContent: "已经为您核对，请重新发起付款", repliedAt: "2026-09-12T02:00:00.000Z", createdAt: "2026-09-12T01:00:00.000Z",
  }];
  const component = evaluate(script.content, {
    vue,
    "@dcloudio/uni-app": { onLoad: callback => hooks.load = callback },
    "../../components/DesktopHeader.vue": { default: {} },
    "../../components/GlobalHelp.vue": { default: {} },
    "../../realm": { isGlobalMall: true },
    "../../api": {
      api: async (path, input) => {
        requests.push({ path, input });
        if (path === "/storefront/bootstrap") return { configs: {} };
        if (path === "/storefront/feedback" && input?.method === "POST") {
          rows = [{ id: "feedback-2", category: input.data.category, content: input.data.content, status: "open", createdAt: "2026-09-12T03:00:00.000Z" }, ...rows];
          return { id: "feedback-2", status: "open" };
        }
        if (path === "/storefront/feedback") return structuredClone(rows);
        throw new Error(`Unexpected API call ${path}`);
      },
      requireLogin: returnTo => { logins.push(returnTo); return true; },
      toast: value => notices.push(String(value)),
    },
  }, { uni: { navigateTo() {}, makePhoneCall() {}, setClipboardData() {} }, location: { assign() {} } }).default;
  const state = component.setup({}, { expose() {} });
  await hooks.load({ section: "feedback" });
  return { state, requests, notices, logins };
}

test("H5 customer center shows only the member feedback history and administrator reply", async () => {
  const h = await harness();
  assert.equal(h.state.active.value, "feedback");
  assert.equal(h.state.feedbackRows.value.length, 1);
  assert.equal(h.state.feedbackRows.value[0].replyContent, "已经为您核对，请重新发起付款");
  assert.equal(h.state.feedbackStatusLabel("resolved"), "已回复");
  assert.deepEqual(h.requests.map(row => row.path), ["/storefront/bootstrap", "/storefront/feedback"]);
  assert.deepEqual(h.logins, ["/pages/help/index?section=feedback"]);
});

test("H5 customer center submits a concise issue and refreshes the visible history", async () => {
  const h = await harness();
  h.state.feedbackIndex.value = 2;
  h.state.feedbackContent.value = " 无法使用手机号登录会员账户 ";
  h.state.feedbackContact.value = " member@example.com ";
  await h.state.submitFeedback();
  const post = h.requests.find(row => row.input?.method === "POST");
  assert.deepEqual(JSON.parse(JSON.stringify(post.input.data)), { category: "account", content: "无法使用手机号登录会员账户", contact: "member@example.com" });
  assert.equal(h.state.feedbackRows.value[0].id, "feedback-2");
  assert.equal(h.state.feedbackContent.value, "");
  assert.equal(h.notices.at(-1), "反馈已提交");
});
