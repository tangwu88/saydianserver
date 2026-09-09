import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = path.resolve(process.argv[2] || "F:/xcodeplace/国内电商/saydianserver");
const req = createRequire(path.join(root, "apps/api/package.json"));
const ts = req("typescript");
req("reflect-metadata");
function transpile(text, name, resolver = req) {
  const m = { exports: {} };
  const code = ts.transpileModule(text, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  new Function("require", "module", "exports", code)(resolver, m, m.exports);
  return m.exports;
}
const permissions = transpile(fs.readFileSync(path.join(root, "packages/contracts/src/admin-permissions.ts"), "utf8"), "admin-permissions.ts");
const auth = transpile(fs.readFileSync(path.join(root, "apps/api/src/admin/admin-auth.ts"), "utf8"), "admin-auth.ts", id => {
  if (id === "../common/prisma.service") return { PrismaService: class {} };
  if (id === "../common/crypto") return { sha256: value => value, randomToken: () => "unused" };
  if (id === "@saydian/app-contracts") return permissions;
  return req(id);
});
const roles = Object.values(req("@prisma/client").AdminRole);
function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
}
function decorators(node) {
  return (ts.getDecorators(node) || []).map(d => d.expression).filter(ts.isCallExpression);
}
function named(node, name) { return decorators(node).find(d => d.expression.getText() === name); }
function values(call) {
  return call?.arguments.map(a => ts.isStringLiteral(a) ? a.text : a.getText().split(".").at(-1));
}
const routes = [];
for (const filename of walk(path.join(root, "apps/api/src")).filter(f => f.endsWith(".controller.ts"))) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  for (const cls of source.statements.filter(ts.isClassDeclaration)) {
    const prefix = values(named(cls, "Controller"))?.[0];
    if (!prefix?.includes("admin/v1")) continue;
    const classGuard = named(cls, "UseGuards")?.arguments.some(a => a.getText() === "AdminAuthGuard");
    for (const method of cls.members.filter(ts.isMethodDeclaration)) {
      const verb = ["Get", "Post", "Patch", "Put", "Delete", "Head"].find(name => named(method, name));
      if (!verb) continue;
      if (!classGuard && !named(method, "UseGuards")?.arguments.some(a => a.getText() === "AdminAuthGuard")) continue;
      const suffix = values(named(method, verb))?.[0] || "";
      routes.push({ method: verb.toUpperCase(), path: "/" + [prefix, suffix].filter(Boolean).join("/"), controller: cls.name.text + "." + method.name.getText(), routeRoles: values(named(method, "AdminRoles")) ?? values(named(cls, "AdminRoles")), file: path.relative(root, filename).replaceAll("\\", "/"), line: source.getLineAndCharacterOfPosition(method.getStart()).line + 1 });
    }
  }
}
async function check(route, granted, options = {}) {
  let session = { id: "session", expiresAt: new Date(Date.now() + 60000), revokedAt: null, admin: { id: "admin", active: true, role: granted[0], roles: granted } };
  session = { ...session, ...options.session, admin: { ...session.admin, ...options.admin } };
  const request = { path: route.path, method: route.method, header: name => options.noToken ? "" : name === "authorization" ? "Bearer demo" : "SUPER_ADMIN", body: { role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] } };
  const guard = new auth.AdminAuthGuard({ adminSession: { findUnique: async () => options.noSession ? null : session } }, { getAllAndOverride: () => route.routeRoles });
  try {
    const result = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }), getHandler: () => ({}), getClass: () => ({}) });
    assert.equal(result, true); assert.deepEqual(request.authAdmin.roles, session.admin.roles.length ? session.admin.roles : [session.admin.role]); return 200;
  } catch (error) {
    const status = error.getStatus?.(); if (![401,403].includes(status)) throw error; return status;
  }
}
let assertions = 0;
for (const route of routes) {
  route.allowed = [];
  const resource = route.path.replace(/^\/api\/saydian-app\/admin\/v1\/?/, "").split("/")[0] || "dashboard";
  const action = ["GET","HEAD"].includes(route.method) ? "read" : /\/(?:refunds?|shipping-refunds)$/.test(route.path) ? "refund" : "write";
  route.resource = resource; route.action = action; route.uiNarrowed = [];
  for (const role of roles) {
    const allowed = permissions.canAdminResource(role, resource, action) && (!route.routeRoles?.length || route.routeRoles.includes(role));
    assert.equal(await check(route,[role]), allowed ? 200 : 403); assertions++;
    if (allowed) route.allowed.push(role);
    else if (permissions.canAdminResource(role,resource,action)) route.uiNarrowed.push(role);
  }
}
const accountWrite = routes.find(r => r.controller === "AdminController.updateAdmin");
assert(accountWrite);
assert.equal(await check(accountWrite, ["READ_ONLY"]), 403); assertions++; // body and arbitrary headers cannot grant roles
assert.equal(await check(accountWrite, ["SUPER_ADMIN"], { noToken:true }), 401); assertions++;
assert.equal(await check(accountWrite, ["SUPER_ADMIN"], { noSession:true }), 401); assertions++;
assert.equal(await check(accountWrite, ["SUPER_ADMIN"], { admin:{active:false} }), 401); assertions++;
assert.equal(await check(accountWrite, ["SUPER_ADMIN"], { session:{revokedAt:new Date()} }), 401); assertions++;
assert.equal(await check(accountWrite, ["SUPER_ADMIN"], { session:{expiresAt:new Date(0)} }), 401); assertions++;
assert.equal(await check(accountWrite, ["READ_ONLY"], { admin:{role:"SUPER_ADMIN",roles:["READ_ONLY"]} }), 403); assertions++;
assert.equal(await check(accountWrite, ["SUPER_ADMIN"], { admin:{roles:[]} }), 200); assertions++;
assert.equal(await check(accountWrite, ["READ_ONLY","SUPER_ADMIN"]), 200); assertions++;
const output = { mode:"PURE_NO_DATABASE_NO_NETWORK", assertions, roles, routes, note:"200 means authorization only, not a real HTTP request or successful operation. Use returned paths with dedicated fixtures for root-owned HTTP acceptance." };
if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(output, null, 2) + "\n");
else {
  console.log(JSON.stringify({ mode:output.mode, assertions, roles, routeCount:routes.length, narrowed:routes.filter(r=>r.uiNarrowed.length).map(({method,path,uiNarrowed})=>({method,path,uiNarrowed})) },null,2));
}
