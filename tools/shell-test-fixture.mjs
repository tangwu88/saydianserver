import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Test doubles only. Production scripts continue to use the real Linux tools.
export const shellPath = value => process.platform === "win32" ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : value;
export const bashCommand = process.env.SAYDIAN_BASH || (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash");
export const shellArgs = (bin, script) => ["-c", 'PATH="$1:$PATH"; export PATH; shift; exec bash "$@"', "fixture", shellPath(bin), ...(process.env.SHELL_FIXTURE_TRACE ? ["-x"] : []), shellPath(script)];
export function shellEnvironment(bin, extra = {}) {
  return { ...process.env, ...extra, MSYS2_ENV_CONV_EXCL: "FIXTURE_SHELL_ROOT", MSYS2_ARG_CONV_EXCL: "*", PATH: process.platform === "win32"
    ? `C:/Program Files/Git/bin;C:/Program Files/Git/usr/bin;${process.env.PATH}`
    : `${bin}:${process.env.PATH}` };
}
export function writeNodeDouble(bin, name, source) {
  const body = source.replace(/^#![^\n]*\n/, "").replace("path.basename(process.argv[1])", "path.basename(process.argv[1]).replace(/\\.cjs$/, '')");
  const prelude = process.platform === "win32" ? `
process.argv = process.argv.map(v => v.replace(/^\\/([a-z])\\//i, (_, d) => d.toUpperCase()+':/'));
if (process.env.FIXTURE_NATIVE_SOURCE) process.env.RELEASE_SOURCE = process.env.FIXTURE_NATIVE_SOURCE;
` : "";
  writeFileSync(join(bin, `${name}.cjs`), prelude + body);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(join(bin, name), `#!/bin/sh\nexec node ${quote(join(bin, `${name}.cjs`).replaceAll("\\", "/"))} "$@"\n`, { mode: 0o755 });
}
export function writeWindowsInstallDouble(bin) {
  if (process.platform !== "win32") return;
  if (process.env.SAYDIAN_JQ) {
    const executable = process.env.SAYDIAN_JQ.replaceAll("\\", "/").replaceAll("'", "'\\''");
    writeFileSync(join(bin, "jq"), `#!/bin/sh\nunset MSYS2_ARG_CONV_EXCL\nexec '${executable}' --binary "$@"\n`, { mode: 0o755 });
  }
  writeNodeDouble(bin, "install", `const fs=require('node:fs'); const a=process.argv.slice(2);
if (a[0]==='-d' && a[1]==='-m') fs.mkdirSync(a[3], {recursive:true});
else if (a[0]==='-m') fs.copyFileSync(a[2], a[3]);
else throw new Error('Unexpected test install invocation');`);
}
