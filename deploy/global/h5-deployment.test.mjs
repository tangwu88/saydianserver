import test from "node:test";
import assert from "node:assert/strict";
import { withGlobalH5Route } from "./install-h5-route.mjs";
import { withH5Switch } from "./configure-h5-runtime.mjs";

const existing = `server {
  server_name app.saydian.cn;
  location /admin/ { proxy_pass http://global-admin:8080; }
  location /saidian-mall/ { proxy_pass http://saydianapp-admin:8080; }
  location ^~ /global/api/ { proxy_pass http://global-api:8080/api/; }
  location = /global { return 404; }
  location ^~ /global/ { return 404; }
}`;
test("H5 gateway patch is additive and keeps domestic and API routes byte-for-byte", () => {
  const changed = withGlobalH5Route(existing);
  assert(changed.includes("location /saidian-mall/ { proxy_pass http://saydianapp-admin:8080; }"));
  assert(changed.includes("location ^~ /global/api/ { proxy_pass http://global-api:8080/api/; }"));
  assert(changed.includes("access_log off;"));
  assert(!changed.includes("proxy_hide_header Referrer-Policy;"));
  assert.equal(changed.replace(/# global-h5 static route v1[\s\S]*?(?=location = \/global \{)/, ""), existing);
});
test("H5 gateway patch is idempotent", () => {
  const changed = withGlobalH5Route(existing);
  assert.equal(withGlobalH5Route(changed), changed);
});
test("H5 gateway patch refuses ambiguous targets and altered installed routes", () => {
  for (const source of ["", existing.replace("global-api:8080/api/", "domestic-api:8080/api/"), existing + "\nlocation = /global {}",
    existing + "\nlocation /global/saidian-mall/ {}", withGlobalH5Route(existing).replace("access_log off;", "access_log on;")]) {
    assert.throws(() => withGlobalH5Route(source));
  }
});
test("H5 switch preserves unrelated configuration and safe defaults", () => {
  const before = "GLOBAL_SMS_PROVIDER=disabled\nGLOBAL_MAINTENANCE_READ_ONLY=true\nSYNTHETIC_SECRET=not-real\n";
  assert.equal(withH5Switch(before, true), before + "GLOBAL_WECHAT_H5_ENABLED=true\n");
  assert.equal(withH5Switch(withH5Switch(before, true), true), withH5Switch(before, true));
  assert.equal(withH5Switch(withH5Switch(before, true), false), before + "GLOBAL_WECHAT_H5_ENABLED=false\n");
  assert.throws(() => withH5Switch("GLOBAL_WECHAT_H5_ENABLED=maybe\n", true));
  assert.throws(() => withH5Switch("GLOBAL_WECHAT_H5_ENABLED=true\nGLOBAL_WECHAT_H5_ENABLED=false\n", true));
});
