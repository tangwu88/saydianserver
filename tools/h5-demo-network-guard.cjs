"use strict";
// Application-level guard for the dedicated local demo API only. This is not an
// OS sandbox: native addons and external executables require an OS egress policy.
if (process.env.H5_DEMO_ENABLED === "true") {
  if (process.env.NODE_ENV !== "development") throw new Error("H5 demo network guard requires development mode");
  const net = require("node:net");
  const dns = require("node:dns");
  const fs = require("node:fs");
  const blocked = () => Object.assign(new Error("Demo permits loopback network access only"), { code: "H5_DEMO_NETWORK_BLOCKED" });
  const hostValue = (value) => {
    if (typeof value !== "string" || !value || value !== value.trim()) throw blocked();
    const host = value.toLowerCase();
    if (host === "localhost") return "127.0.0.1";
    const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (net.isIP(bare) === 4 && bare.startsWith("127.")) return bare;
    if (net.isIP(bare) === 6 && !bare.includes("%")) {
      const canonical = new URL(`http://[${bare}]/`).hostname;
      if (canonical === "[::1]") return "::1";
      if (/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(canonical)) return bare;
    }
    throw blocked();
  };
  function connectionArgs(args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const first = values[0];
    if (first && typeof first === "object") {
      if (first.path !== undefined || first.handle !== undefined || first.fd !== undefined || first.socket !== undefined) throw blocked();
      // Rewrite localhost before Node or a user-supplied lookup can resolve it.
      first.host = hostValue(first.host ?? (first.family === 6 ? "::1" : "127.0.0.1"));
      if (first.lookup) delete first.lookup;
    } else {
      if (typeof first === "string" && !/^\d+$/.test(first)) throw blocked();
      if (typeof values[1] === "string") values[1] = hostValue(values[1]);
    }
    for (const value of values.slice(1)) {
      if (value && typeof value === "object") {
        if (value.path !== undefined || value.socket !== undefined) throw blocked();
        if (value.host !== undefined) value.host = hostValue(value.host);
        if (value.lookup) delete value.lookup;
      }
    }
    return args;
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) { return connect.apply(this, connectionArgs(args)); };
  const tls = require("node:tls");
  const tlsConnect = tls.connect;
  tls.connect = function (...args) { return tlsConnect.apply(this, connectionArgs(args)); };

  function httpTarget(args) {
    let options = {};
    if (typeof args[0] === "string" || args[0] instanceof URL) {
      const url = new URL(args[0]);
      if (!["http:", "https:"].includes(url.protocol)) throw blocked();
      options = { hostname: url.hostname };
      if (args[1] && typeof args[1] === "object") Object.assign(options, args[1]);
    } else if (args[0] && typeof args[0] === "object") options = args[0];
    if (options.socketPath !== undefined) throw blocked();
    hostValue(options.hostname ?? options.host ?? "127.0.0.1");
  }
  for (const protocol of [require("node:http"), require("node:https")]) {
    for (const method of ["request", "get"]) {
      const original = protocol[method];
      protocol[method] = function (...args) { httpTarget(args); return original.apply(this, args); };
    }
  }
  if (globalThis.fetch) {
    const fetch = globalThis.fetch;
    globalThis.fetch = function (input, options) {
      try { httpTarget([typeof input === "string" || input instanceof URL ? input : input.url]); }
      catch (error) { return Promise.reject(error); }
      return fetch.call(this, input, options);
    };
  }

  function localLookup(host, options = {}) {
    const address = hostValue(host);
    const family = net.isIP(address);
    const requested = typeof options === "number" ? options : options?.family;
    const selected = host === "localhost" && requested === 6 ? "::1" : address;
    const result = { address: selected, family: net.isIP(selected) || family };
    return options?.all ? [result] : result;
  }
  dns.lookup = function (host, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    if (typeof callback !== "function") throw new TypeError("lookup callback required");
    try {
      const result = localLookup(host, options);
      process.nextTick(() => Array.isArray(result) ? callback(null, result) : callback(null, result.address, result.family));
    } catch (error) { process.nextTick(callback, error); }
  };
  dns.promises.lookup = async (host, options) => localLookup(host, options);
  const denyDns = function (...args) {
    const callback = args[args.length - 1];
    if (typeof callback === "function") { process.nextTick(callback, blocked()); return; }
    throw blocked();
  };
  for (const target of [dns, dns.Resolver.prototype]) {
    for (const key of Object.getOwnPropertyNames(target)) {
      if (/^(resolve|reverse|lookupService)/.test(key) && typeof target[key] === "function") target[key] = denyDns;
    }
  }
  for (const target of [dns.promises, dns.promises.Resolver.prototype]) {
    for (const key of Object.getOwnPropertyNames(target)) {
      if (/^(resolve|reverse|lookupService)/.test(key) && typeof target[key] === "function") target[key] = async () => { throw blocked(); };
    }
  }

  function localPath(value) {
    if (value instanceof URL) { if (value.protocol !== "file:" || value.hostname) throw blocked(); return; }
    const text = Buffer.isBuffer(value) ? value.toString() : value;
    // Node's Windows module loader uses extended-length local drive paths.
    // Do not admit \\?\UNC\, device paths, or remote shares.
    if (typeof text === "string" && /^\\\\\?\\[a-z]:\\/i.test(text)) return;
    if (typeof text === "string" && (/^[\\/]{2}/.test(text) || /^\\(?:\?\?|Device)\\/i.test(text))) throw blocked();
  }
  const pathMethods = ["access", "appendFile", "chmod", "chown", "copyFile", "cp", "exists", "lchmod", "lchown", "link", "lstat", "lutimes", "mkdir", "mkdtemp", "open", "opendir", "readFile", "readdir", "readlink", "realpath", "rename", "rm", "rmdir", "stat", "statfs", "symlink", "truncate", "unlink", "utimes", "watch", "watchFile", "writeFile", "createReadStream", "createWriteStream"];
  const twoPaths = new Set(["copyFile", "cp", "link", "rename", "symlink"]);
  function checkPaths(name, args) { localPath(args[0]); if (twoPaths.has(name)) localPath(args[1]); }
  for (const name of pathMethods) {
    for (const suffix of ["", "Sync"]) {
      const key = name + suffix;
      if (typeof fs[key] !== "function") continue;
      const original = fs[key];
      const wrapped = function (...args) {
        try { checkPaths(name, args); }
        catch (error) {
          const callback = args[args.length - 1];
          if (!suffix && name === "exists" && typeof callback === "function") { process.nextTick(callback, false); return; }
          if (!suffix && typeof callback === "function") { process.nextTick(callback, error); return; }
          throw error;
        }
        return original.apply(this, args);
      };
      if (original.native) wrapped.native = function (...args) { checkPaths(name, args); return original.native.apply(this, args); };
      fs[key] = wrapped;
    }
    if (typeof fs.promises[name] === "function") {
      const original = fs.promises[name];
      fs.promises[name] = async function (...args) { checkPaths(name, args); return original.apply(this, args); };
    }
  }
  require("node:module").syncBuiltinESMExports();
}
