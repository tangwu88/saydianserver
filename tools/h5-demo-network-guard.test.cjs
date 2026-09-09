"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const guard = path.join(__dirname, "h5-demo-network-guard.cjs");
function isolated(source, enabled = "true", mode = "development") {
  const result = spawnSync(process.execPath, ["-r", guard, "-e", source], {
    env: { ...process.env, H5_DEMO_ENABLED: enabled, NODE_ENV: mode, NODE_OPTIONS: "" },
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
}
test("demo rejects TCP/TLS/HTTP/fetch before public network or DNS access", () => isolated(`
  const a = require('node:assert/strict');
  const net = require('node:net'); const tls = require('node:tls');
  const http = require('node:http'); const https = require('node:https');
  const blocked = { code: 'H5_DEMO_NETWORK_BLOCKED' };
  for (const invoke of [
    () => net.connect(443, '203.0.113.5'),
    () => net.connect({port:443,host:'example.invalid'}),
    () => new net.Socket().connect([{port:443,host:'::ffff:203.0.113.5'}]),
    () => net.connect({port:443,host:'0.0.0.0'}),
    () => net.connect({path:'\\\\\\\\example.invalid\\\\pipe\\\\demo'}),
    () => net.connect('/tmp/demo-network-denied.sock'),
    () => tls.connect(443, '203.0.113.5'),
    () => tls.connect({port:443,host:'example.invalid'}),
    () => http.get('http://203.0.113.5/'),
    () => https.request('https://example.invalid/'),
    () => http.request('http://127.0.0.1/', {hostname:'203.0.113.5'}),
    () => http.request({socketPath:'\\\\\\\\example.invalid\\\\pipe\\\\demo'}),
  ]) a.throws(invoke, blocked);
  (async () => {
    await a.rejects(fetch('https://example.invalid/'), blocked);
    await a.rejects(fetch(new Request('http://203.0.113.5/')), blocked);
  })().catch(error => { console.error(error); process.exitCode=1; });
`));
test("demo DNS lookup is local-only and resolver APIs cannot send DNS packets", () => isolated(`
  const a=require('node:assert/strict'); const dns=require('node:dns');
  const {promisify}=require('node:util'); const blocked={code:'H5_DEMO_NETWORK_BLOCKED'};
  (async()=>{
    a.deepEqual(await dns.promises.lookup('localhost'), {address:'127.0.0.1',family:4});
    a.deepEqual(await dns.promises.lookup('localhost',{family:6}), {address:'::1',family:6});
    a.deepEqual(await dns.promises.lookup('::ffff:127.0.0.1'), {address:'::ffff:127.0.0.1',family:6});
    await a.rejects(promisify(dns.lookup)('example.invalid'),blocked);
    await a.rejects(dns.promises.resolve4('example.invalid'),blocked);
    await a.rejects(promisify(new dns.Resolver().resolve4.bind(new dns.Resolver()))('example.invalid'),blocked);
    await a.rejects(new dns.promises.Resolver().resolve4('example.invalid'),blocked);
  })().catch(error=>{console.error(error);process.exitCode=1});
`));
test("demo allows loopback HTTP and normalized Socket arguments", () => isolated(`
  const a=require('node:assert/strict'); const http=require('node:http'); const net=require('node:net');
  const server=http.createServer((req,res)=>res.end('local-ok'));
  server.listen(0,'127.0.0.1',async()=>{
    try {
      const port=server.address().port;
      a.equal(await (await fetch('http://localhost:'+port)).text(),'local-ok');
      await new Promise((resolve,reject)=>{
        const socket=net.createConnection({host:'127.0.0.1',port},()=>{socket.end();resolve()});socket.on('error',reject);
      });
    } catch(error){console.error(error);process.exitCode=1}
    finally {server.close();server.closeAllConnections()}
  });
`));
test("demo rejects UNC filesystem and file URL access before OS calls", () => isolated(`
  const a=require('node:assert/strict');const fs=require('node:fs');const blocked={code:'H5_DEMO_NETWORK_BLOCKED'};
  a.throws(()=>fs.readFileSync('//example.invalid/share/private'),blocked);
  a.throws(()=>fs.openSync(new URL('file://example.invalid/share/private'),'r'),blocked);
  (async()=>{await a.rejects(fs.promises.readFile('//example.invalid/share/private'),blocked)})().catch(error=>{console.error(error);process.exitCode=1});
`));
test("non-demo processes are unchanged without making a network request", () => isolated(`
  const a=require('node:assert/strict');const net=require('node:net');const fs=require('node:fs');
  const before=net.Socket.prototype.connect;const read=fs.readFileSync;const request=globalThis.fetch;
  delete require.cache[require.resolve(${JSON.stringify(guard)})];require(${JSON.stringify(guard)});
  a.equal(before,net.Socket.prototype.connect);a.equal(read,fs.readFileSync);a.equal(request,globalThis.fetch);
`, "false"));
test("demo flag in a non-development process fails closed", () => {
  const result=spawnSync(process.execPath,["-r",guard,"-e","process.exit(0)"],{env:{...process.env,H5_DEMO_ENABLED:"true",NODE_ENV:"production",NODE_OPTIONS:""},encoding:"utf8",windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/requires development mode/);
});
test("Windows extended local paths used by ts-node remain readable", () => isolated(
  "const fs=require('node:fs'),p=require('node:path'),a=require('node:assert/strict');a.ok(fs.readFileSync(p.toNamespacedPath(" +
  JSON.stringify(__filename) + "),'utf8').includes('demo flag'));"
));
