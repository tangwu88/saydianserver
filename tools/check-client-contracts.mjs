import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeClientPath(value) {
  return String(value).split("?")[0].replace(/:[A-Za-z0-9_]+|\{[^}]+\}|\$[A-Za-z0-9_]+/g, "{id}").replace(/\/$/, "");
}

export function findMissingConsumers(consumers, routes) {
  const defined = new Set(routes.map(route => `${route.method.toUpperCase()} ${normalizeClientPath(route.path)}`));
  return consumers.filter(route => !defined.has(`${route.method.toUpperCase()} ${normalizeClientPath(route.path)}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "apps/api/src/legacy/fixtures/flutter-fa79aa3-consumers.json"), "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "docs/api-catalog.json"), "utf8"));
  const missing = findMissingConsumers(baseline.consumers, catalog.routes);
  console.log(JSON.stringify({ clientCommit: baseline.clientCommit, consumers: baseline.consumers.length, missing, scope: "route-presence-only; field parsing and real-device acceptance are separate gates" }, null, 2));
  if (missing.length) process.exitCode = 1;
}
