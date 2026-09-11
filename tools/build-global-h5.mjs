import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const pnpmArguments = ["--filter", "@saydian/app-shop", "build:h5"];
const pnpmEntry = process.env.npm_execpath;
const command = pnpmEntry ? process.execPath : process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "pnpm";
const arguments_ = pnpmEntry ? [pnpmEntry, ...pnpmArguments] : process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd", ...pnpmArguments] : pnpmArguments;
const result = spawnSync(command, arguments_, {
  cwd: resolve(import.meta.dirname, ".."),
  env: {
    ...process.env,
    VITE_APP_REALM: "global",
    VITE_API_BASE: "/global/api/saidian-mall/v1",
    VITE_PUBLIC_BASE: "/global/saidian-mall/",
  },
  stdio: "inherit",
  windowsHide: true,
});

assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.signal, null, `Global H5 build terminated by ${result.signal}`);
assert.equal(result.status, 0, `Global H5 build failed with exit code ${result.status}`);

const index = readFileSync(resolve(import.meta.dirname, "../apps/shop/dist/build/h5/index.html"), "utf8");
assert(index.includes('/global/saidian-mall/assets/'), "Global H5 build did not use the independent public base");
