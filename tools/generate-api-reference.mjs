import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { notes } from "./api-notes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["status.controller.ts", ...["auth", "members", "health", "devices", "care", "notifications", "content", "support", "commerce", "admin"].map(name => `${name}/${name}.controller.ts`), ...["site", "member", "content", "commerce", "files"].map(name => `legacy/legacy-${name}.controller.ts`)];
const methods = new Set(["Get", "Post", "Put", "Patch", "Delete", "Head", "Options"]);
const decorators = node => (ts.canHaveDecorators(node) ? ts.getDecorators(node) : []) ?? [];
function calls(node) {
  return decorators(node).map(item => item.expression).filter(ts.isCallExpression);
}
const named = (node, name) => calls(node).find(call => call.expression.getText() === name);
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : "";
const routes = [];
for (const file of files) {
  const relative = `apps/api/src/${file}`;
  const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), "utf8"), ts.ScriptTarget.Latest, true);
  for (const controller of source.statements.filter(ts.isClassDeclaration)) {
    const prefix = named(controller, "Controller");
    if (!prefix) continue;
    for (const method of controller.members.filter(ts.isMethodDeclaration)) {
      const route = calls(method).find(call => methods.has(call.expression.getText()));
      if (!route) continue;
      const key = `${controller.name.text}.${method.name.getText()}`;
      if (!notes[key]) throw new Error(`Missing interface explanation: ${key}`);
      const guards = [...(named(controller, "UseGuards")?.arguments ?? []), ...(named(method, "UseGuards")?.arguments ?? [])].map(arg => arg.getText());
      const auth = guards.includes("AdminAuthGuard") ? "admin" : guards.includes("UserAuthGuard") ? "member" : "public";
      const roles = (named(method, "AdminRoles")?.arguments ?? []).map(arg => arg.getText().replace("AdminRole.", ""));
      const parameters = method.parameters.flatMap(parameter => calls(parameter).filter(call => ["Body", "Query", "Param", "Headers", "UploadedFile"].includes(call.expression.getText())).map(call => ({
        in: { Body: "body", Query: "query", Param: "path", Headers: "header", UploadedFile: "file" }[call.expression.getText()],
        name: literal(call.arguments[0]) || (call.expression.getText() === "UploadedFile" ? "file" : "*"),
        type: parameter.type?.getText(source) ?? "unknown",
        optional: Boolean(parameter.questionToken || parameter.initializer),
      })));
      routes.push({ key, method: route.expression.getText().toUpperCase(), path: "/" + [literal(prefix.arguments[0]), literal(route.arguments[0])].filter(Boolean).join("/"), auth, roles, parameters, envelope: named(controller, "RawResponse") || named(method, "RawResponse") ? "raw-or-legacy" : "v2", source: relative, ...notes[key] });
    }
  }
}
for (const key of Object.keys(notes)) if (!routes.some(route => route.key === key)) throw new Error(`Stale interface explanation: ${key}`);
const seen = new Set();
for (const route of routes) {
  const key = route.method + " " + route.path;
  if (seen.has(key)) throw new Error(`Duplicate route: ${key}`);
  seen.add(key);
}
const escape = value => String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const lines = ["# API 逐路由目录", "", `本文件由控制器和人工复核说明生成，共 **${routes.length} 条 HTTP 路由**。这代表源码覆盖，不代表生产业务全部可用。`, "", "调用前先读 [接口调用手册](api-guide.md)；上线缺口见 [旧后台对接与缺陷清单](api-coverage.md)。", "", "生成：`pnpm api:docs`；校验：`pnpm api:docs:check`。每次新增、删除或修改参数，须同步 tools/api-notes.mjs。", ""];
for (const [name, predicate] of [["健康检查", r => r.path.startsWith("/health/")], ["V1 兼容接口", r => r.key.startsWith("Legacy")], ["V2 App 接口", r => r.path.startsWith("/api/saydian-app/v2/")], ["管理后台接口", r => r.path.startsWith("/api/saydian-app/admin/")]]) {
  const selected = routes.filter(predicate);
  lines.push(`## ${name}（${selected.length}）`, "", "| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |", "| --- | --- | --- | --- | --- | --- |");
  for (const r of selected) {
    const locations = r.parameters.filter(p => p.in !== "body").map(p => `${p.in}:${p.name}${p.optional ? "?" : ""}`).join("，");
    lines.push(`| \`${r.method} ${r.path}\` | ${escape(r.summary)} | ${r.auth}${r.roles.length ? ": " + r.roles.join(", ") : ""} | ${escape([locations, r.request].filter(Boolean).join("；"))} | ${escape(r.response)} | ${escape(r.dependency)} |`);
  }
  lines.push("");
}
const outputs = { "docs/api-reference.md": lines.join("\n"), "docs/api-catalog.json": JSON.stringify({ schemaVersion: 1, routes }, null, 2) + "\n" };
for (const [file, content] of Object.entries(outputs)) {
  const target = path.join(root, file);
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== content) throw new Error(`${file} is stale; run pnpm api:docs`);
  } else fs.writeFileSync(target, content);
}
console.log(`API catalog: ${routes.length} routes, all described; ${process.argv.includes("--check") ? "verified" : "generated"}.`);
