import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function replaceManagedBlock(source, transform) {
  const begin = "# BEGIN SAYDIAN APP HTTPS app.saydian.cn";
  const end = "# END SAYDIAN APP HTTPS app.saydian.cn";
  assert(source.split(begin).length === 2 && source.split(end).length === 2, "Expected exactly one managed TLS block");
  const start = source.indexOf(begin), finish = source.indexOf(end) + end.length;
  assert(finish > start);
  return source.slice(0, start) + transform(source.slice(start, finish)) + source.slice(finish);
}

export function unifyGateway(source) {
  return replaceManagedBlock(source, initial => {
    let block = initial;
    assert(block.includes("location ^~ /global/api/") && block.includes("location /admin/"), "Required existing routes missing");
    block = block.replace(/proxy_pass http:\/\/(?:saydianapp-api|global-api|unified-api):8080[^;]*;/g, "proxy_pass http://unified-api:8080;")
      .replaceAll("proxy_pass http://saydianapp-admin:8080;", "proxy_pass http://global-admin:8080;")
      .replace(/(location = \/global\/api\s*\{)\s*return 308 \/global\/api\//, "$1\n    proxy_pass http://unified-api:8080;");
    assert(!/proxy_pass http:\/\/(?:saydianapp-api|global-api):/.test(block));
    assert(!/location[^\n]*\/global\/api[^}]*return 30[1278]/s.test(block), "API redirects are not allowed");
    if (!block.includes("location = /api/saydian-app/admin/v1/app-packages")) {
      block = block.replace("  location /admin/ {", `  location = /api/saydian-app/admin/v1/app-packages {
    client_max_body_size 130m;
    proxy_pass http://unified-api:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }

  location /admin/ {`);
    }
    // Reconcile Say Ring's existing public routes without changing its documents.
    if (!block.includes("location = /say-ring/privacy")) {
      const marker = "  location /saidian-mall/ {";
      assert(block.split(marker).length === 2, "Expected exactly one mall route for Say Ring legal-route insertion");
      block = block.replace(marker, `  location = /say-ring/privacy {
    proxy_pass http://global-admin:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }

  location = /say-ring/terms {
    proxy_pass http://global-admin:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }

${marker}`);
    }
    // Older managed gateways need these public pages before their generic /global fallback.
    const routes = ["location = /down2 {", "location = /down2/ {", "location = /global/privacy-policy", "location = /global/terms", "location = /global/support", "location = /global/account-deletion", "location ^~ /global/public-assets/", "location ^~ /global/down/files/", "location = /global/down {", "location = /global/down/ {"];
    for (const [index, marker] of routes.entries()) {
      const count = block.split(marker).length - 1;
      if (count > 1) throw new Error(`Duplicate public route: ${marker}`);
      if (count === 1) {
        const start = block.indexOf(marker), end = block.indexOf("}", start);
        if (end < 0 || !block.slice(start, end).includes("proxy_pass http://global-admin:8080;"))
          throw new Error(`Public route must use the global static upstream: ${marker}`);
        continue;
      }
      const next = routes.slice(index + 1).find(route => block.includes(route)) ?? "location = /global {";
      const nextStart = block.indexOf(next);
      if (nextStart < 0 || block.indexOf(next, nextStart + 1) >= 0)
        throw new Error(`Expected one insertion point for ${marker}`);
      const insertionStart = block.lastIndexOf("\n", nextStart) + 1;
      const route = `  ${marker.endsWith("{") ? marker : `${marker} {`}\n    proxy_pass http://global-admin:8080;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-Proto https;\n  }\n\n`;
      block = block.slice(0, insertionStart) + route + block.slice(insertionStart);
    }
    return block;
  });
}

export const cutoverCallbackPattern = "^/(global/)?api/saydian-app/v2/billing/(payments/(wechat(/app)?/(notify|refund-notify)|alipay(/app)?/notify)|apple/notifications)/?$";
export function freezeGateway(source) {
  return replaceManagedBlock(source, block => {
    assert(!block.includes("$saydian_cutover_block"), "Gateway is already frozen");
    const host = "server_name app.saydian.cn;";
    assert(block.split(host).length === 2, "Expected the exact application TLS host");
    // Server rewrite phase runs before all API locations, including legacy GETs
    // that lazily create compatibility IDs. Static pages and health stay readable.
    return block.replace(host, `${host}
  set $saydian_cutover_block 0;
  if ($uri ~* "^/(global/)?api(/|$)") { set $saydian_cutover_block 1; }
  if ($uri ~ "${cutoverCallbackPattern}") { set $saydian_cutover_block 0; }
  if ($saydian_cutover_block = 1) { return 503; }`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, mode] = process.argv.slice(2);
  assert(input && output && input !== output);
  assert(mode === undefined || mode === "freeze");
  writeFileSync(output, (mode === "freeze" ? freezeGateway : unifyGateway)(readFileSync(input, "utf8")), { flag: "wx", mode: 0o600 });
}
