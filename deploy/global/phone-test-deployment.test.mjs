import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { withPhoneTestSwitch } from "./configure-phone-test-runtime.mjs";

test("phone entry has a separate opt-in flag, preserving SMS and maintenance", () => {
  const before = "GLOBAL_WECHAT_H5_ENABLED=true\nGLOBAL_SMS_PROVIDER=disabled\nGLOBAL_MAINTENANCE_READ_ONLY=true\nSYNTHETIC_SECRET=not-real\n";
  const enabled = withPhoneTestSwitch(before, true);
  assert.equal(enabled, before + "GLOBAL_WECHAT_PHONE_TEST_ENABLED=true\n");
  assert.equal(withPhoneTestSwitch(enabled, true), enabled);
  assert.equal(withPhoneTestSwitch(enabled, false), before + "GLOBAL_WECHAT_PHONE_TEST_ENABLED=false\n");
});
test("phone test activation rejects missing WeChat authorization and ambiguous switches", () => {
  assert.throws(() => withPhoneTestSwitch("GLOBAL_WECHAT_H5_ENABLED=false\n", true));
  assert.throws(() => withPhoneTestSwitch("", true));
  assert.throws(() => withPhoneTestSwitch("GLOBAL_WECHAT_PHONE_TEST_ENABLED=yes\n", false));
  assert.throws(() => withPhoneTestSwitch("GLOBAL_WECHAT_PHONE_TEST_ENABLED=true\nGLOBAL_WECHAT_PHONE_TEST_ENABLED=false\n", false));
  assert.throws(() => withPhoneTestSwitch("", "true"));
});
test("test flag never enables real OTP or the Worker", () => {
  const compose = JSON.parse(readFileSync(new URL("./compose.json", import.meta.url), "utf8"));
  assert.equal(compose.services["global-api"].environment.GLOBAL_WECHAT_PHONE_TEST_ENABLED, "${GLOBAL_WECHAT_PHONE_TEST_ENABLED-true}");
  assert.equal(compose.services["global-worker"].environment.GLOBAL_WECHAT_PHONE_TEST_ENABLED, undefined);
  for (const name of ["global-api", "global-worker"]) {
    assert.equal(compose.services[name].environment.ALLOW_TEST_OTP, "false");
    assert.equal(compose.services[name].environment.GLOBAL_SMS_PROVIDER, "disabled");
  }
});

test("fresh private config stays explicit and the runtime helper can disable the temporary release", () => {
  const example = readFileSync(new URL("./env.example", import.meta.url), "utf8");
  assert.match(example, /^GLOBAL_WECHAT_PHONE_TEST_ENABLED=false$/m);
  assert.equal(withPhoneTestSwitch("GLOBAL_WECHAT_H5_ENABLED=true\n", false), "GLOBAL_WECHAT_H5_ENABLED=true\nGLOBAL_WECHAT_PHONE_TEST_ENABLED=false\n");
});
