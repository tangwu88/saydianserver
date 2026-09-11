// Load the actual realm modules against a test document's isolated uni storage.
// This keeps key prefixes/config guards in sync without mocking them away.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const defaultRepo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function realmTestModules(uni, { repo = defaultRepo, source = relative => readFileSync(resolve(repo, relative), "utf8"), mini = false, env = {} } = {}) {
  const ts = createRequire(resolve(repo, "apps/api/package.json"))("typescript");
  const load = (relative, imports = {}) => {
    let code = source(relative).replaceAll("import.meta.env", "__env");
    if (!mini) code = code.replace(/\/\* #ifdef MP-WEIXIN \*\/[\s\S]*?\/\* #endif \*\//g, "");
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(js, { module, exports: module.exports, uni, __env: env, Error,
      require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected realm import: " + name); return imports[name]; },
    }, { filename: relative });
    return module.exports;
  };
  const config = load("apps/shop/src/realm-config.ts");
  const realm = load("apps/shop/src/realm.ts", { "./realm-config": config });
  return { realm, config };
}
