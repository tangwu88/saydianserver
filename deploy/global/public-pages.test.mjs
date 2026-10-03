import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { unifyGateway } from "../scripts/unify-gateway.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Health public pages are international-only and use the published server contracts", () => {
  const routes = read("./nginx.locations.conf");
  const admin = read("../../docker/admin-nginx.conf");
  const pages = ["privacy-policy", "terms", "support", "account-deletion"];
  for (const page of pages) {
    assert.match(
      routes,
      new RegExp(
        `location = /global/${page} \\{[\\s\\S]*?proxy_pass http://global-admin:8080;`,
      ),
    );
    assert.match(
      admin,
      new RegExp(
        `location = /global/${page} \\{[\\s\\S]*?try_files /down/global/${page}\\.html =404;`,
      ),
    );
  }
  assert.match(routes, /location \^~ \/global\/api\//);
  assert.match(routes, /location \^~ \/global\/public-assets\//);
  assert.match(admin, /location \^~ \/global\/public-assets\//);
  assert.match(
    admin,
    /Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'/,
  );

  const legal = read(
    "../../apps/download-web/public/global/public-assets/global-legal.js",
  );
  assert.match(legal, /auth\/capabilities\?locale=en/);
  assert.match(legal, /fetch\(`\/global\$\{reference\.path\}`/);
  assert.match(
    legal,
    /document\.querySelector\("#document-content"\)\.innerHTML = safeHtml/,
  );
  assert.match(legal, /clean\(element\);\s*element\.replaceWith/);
  assert.doesNotMatch(legal, /say-ring|global-appstore-2026-10-02/);

  const support = read(
    "../../apps/download-web/public/global/public-assets/global-support.js",
  );
  assert.match(support, /\/global\/api\/saydian-app\/v2\/support\/config/);
  assert.match(support, /config\?\.configured/);

  const deletion = read(
    "../../apps/download-web/public/global/public-assets/global-account-deletion.js",
  );
  assert.match(deletion, /\/auth\/delete-account/);
  assert.match(deletion, /capabilities\?locale=en/);
  assert.match(deletion, /capabilities\?\.login\?\.sms === true/);
  assert.match(deletion, /if \(!smsLoginAvailable\)/);
  assert.match(deletion, /delete-confirm/);
  assert.match(deletion, /executeAfter/);
  assert.doesNotMatch(deletion, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(deletion, /say-ring|product:\s*["']say-ring/);
  for (const page of pages)
    assert.match(
      read(`../../apps/download-web/public/global/${page}.html`),
      /<html lang="en">/,
    );
});

test("global public routes are restored idempotently without changing API forwarding", () => {
  const template = read("../nginx/app-https.conf.template").replaceAll(
    "__APP_DOMAIN__",
    "app.saydian.cn",
  );
  const routes = read("./nginx.locations.conf");
  const full = template.replace("__SAYDIAN_GLOBAL_ROUTES__", routes);
  const publicRouteBlock =
    /  location = \/global\/privacy-policy \{[\s\S]*?  location \^~ \/global\/public-assets\/ \{[\s\S]*?\n  \}\n\n/;
  const legacy = full.replace(publicRouteBlock, "");
  const reconciled = unifyGateway(legacy);
  for (const page of [
    "privacy-policy",
    "terms",
    "support",
    "account-deletion",
  ]) {
    assert.equal(
      (reconciled.match(new RegExp(`location = /global/${page}`, "g")) ?? [])
        .length,
      1,
    );
  }
  assert.equal(
    (reconciled.match(/location \^~ \/global\/public-assets\//g) ?? []).length,
    1,
  );
  assert.equal(unifyGateway(reconciled), reconciled);
  assert.match(
    reconciled,
    /location \^~ \/global\/api\/ \{\s*proxy_pass http:\/\/unified-api:8080;/,
  );
  assert.doesNotMatch(
    reconciled,
    /location \^~ \/global\/api\/[^}]*return 30[1278]/s,
  );
});

test("Health package alias shares existing read-only downloads and is restored without API redirects", () => {
  const admin = read("../../docker/admin-nginx.conf");
  assert.match(admin, /location \^~ \/global\/down\/files\/ \{\s*rewrite \^\/global\/down\/files\/\(\.\*\)\$ \/down\/files\/\$1 last;/);
  const full = read("../nginx/app-https.conf.template")
    .replaceAll("__APP_DOMAIN__", "app.saydian.cn")
    .replace("__SAYDIAN_GLOBAL_ROUTES__", read("./nginx.locations.conf"));
  const legacy = full.replace(/location \^~ \/global\/down\/files\/ \{[^}]*\}\n\n/, "");
  const result = unifyGateway(legacy);
  assert.equal((result.match(/location \^~ \/global\/down\/files\//g) ?? []).length, 1);
  assert.match(result, /location \^~ \/global\/down\/files\/ \{\s*proxy_pass http:\/\/global-admin:8080;/);
  assert.equal(unifyGateway(result), result);
  assert.throws(() => unifyGateway(result.replace(/(location \^~ \/global\/down\/files\/ \{\s*)proxy_pass http:\/\/global-admin:8080;/, "$1proxy_pass http://unexpected:8080;")));
  assert.throws(() => unifyGateway(result.replace("location ^~ /global/down/files/ {", "location ^~ /global/down/files/ {}\n  location ^~ /global/down/files/ {")));
});
