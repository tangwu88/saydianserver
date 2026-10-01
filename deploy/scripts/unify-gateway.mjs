import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function unifyGateway(source) {
  const begin = "# BEGIN SAYDIAN APP HTTPS app.saydian.cn";
  const end = "# END SAYDIAN APP HTTPS app.saydian.cn";
  assert(source.split(begin).length === 2 && source.split(end).length === 2, "Expected exactly one managed TLS block");
  const start = source.indexOf(begin), finish = source.indexOf(end) + end.length;
  assert(finish > start);
  let block = source.slice(start, finish);
  assert(block.includes("location ^~ /global/api/") && block.includes("location /admin/"), "Required existing routes missing");
  block = block.replace(/proxy_pass http:\/\/(?:saydianapp-api|global-api|unified-api):8080[^;]*;/g, "proxy_pass http://unified-api:8080;")
    .replaceAll("proxy_pass http://saydianapp-admin:8080;", "proxy_pass http://global-admin:8080;")
    .replace(/(location = \/global\/api\s*\{)\s*return 308 \/global\/api\/;/, "$1\n    proxy_pass http://unified-api:8080;");
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
  return source.slice(0, start) + block + source.slice(finish);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  assert(input && output && input !== output);
  writeFileSync(output, unifyGateway(readFileSync(input, "utf8")), { flag: "wx", mode: 0o600 });
}
