// Disposable loopback-only catalog UI fixture. No database, supplier or network client.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const catalogBase = "/global/saidian-mall/";
export const catalogApi = "/global/api/saidian-mall/v1";
const image = "/fixture/product-placeholder.svg";
const categories = [{ id: "fixture-watch", name: "手表（测试）" }, { id: "fixture-accessory", name: "配件（测试）" }];
const products = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1, watch = n <= 27;
  return { id: `fixture-product-${String(n).padStart(2, "0")}`, name: `${watch ? "A 手表" : "B 配件"} ${String(n).padStart(2, "0")}（合成测试）`,
    categoryId: categories[watch ? 0 : 1].id, subtitle: "仅本地界面测试，非真实商品或报价", coverImage: image,
    tags: ["合成测试数据"], priceCents: 10000 + n * 100, stock: n === 2 ? 0 : 10, sales: 31 - n };
});
const capabilities = { realm: "global", login: { password: { enabled: false }, sms: { enabled: false }, wechatH5: { enabled: false } },
  checkout: { enabled: false, points: { supported: false, requiresVerifiedAccount: true } }, payments: [], maintenance: { readOnly: true }, demo: false };
const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

// A visible, same-origin fetch avoids relying on the host browser's native form navigation.
export const catalogControlScript = `
const form = document.querySelector('form[action="/fixture/control"]');
const status = document.getElementById('control-status');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const action = event.submitter?.value;
  if (!['products', 'bootstrap', 'clear'].includes(action)) { status.textContent = '请选择一个故障控制按钮'; return; }
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => button.disabled = true);
  status.textContent = '正在提交本地控制…';
  try {
    const response = await fetch('/fixture/control', { method: 'POST', mode: 'same-origin', credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ action, csrf: form.querySelector('[name="csrf"]').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '本地控制请求被拒绝，请刷新控制页重试');
    document.getElementById('products-state').textContent = result.pending.products ? '已开启一次' : '关闭';
    document.getElementById('bootstrap-state').textContent = result.pending.bootstrap ? '已开启一次' : '关闭';
    status.textContent = '控制已生效；返回商城触发对应请求即可。';
  } catch (error) { status.textContent = '控制未生效：' + (error.message || '网络失败'); }
  finally { buttons.forEach(button => button.disabled = false); }
});`;

export async function createCatalogFixture({ buildRoot = resolve(repo, "apps/shop/dist/build/h5"), staticRoot = resolve(repo, "apps/shop/src/static") } = {}) {
  buildRoot = await realpath(buildRoot); staticRoot = await realpath(staticRoot);
  const index = await readFile(resolve(buildRoot, "index.html"), "utf8");
  assert(index.includes(`${catalogBase}assets/`) && !/(?:src|href)=["']\/saidian-mall\//.test(index), "Build the independent global H5 before starting this fixture");
  const csrf = randomBytes(24).toString("hex");
  const pending = { products: false, bootstrap: false };
  const evidence = { bootstrapReads: 0, productLists: 0, productDetails: 0, categoryReads: 0, productsFailures: 0, bootstrapFailures: 0, rejectedWrites: 0, externalCalls: 0, controlsReceived: 0, controlsAccepted: 0, controlRejections: [], requests: [] };
  const server = createServer(async (req, res) => {
    const port = server.address()?.port, host = req.headers.host;
    res.setHeader("cache-control", "no-store"); res.setHeader("content-security-policy", csp);
    res.setHeader("x-content-type-options", "nosniff"); res.setHeader("referrer-policy", "no-referrer");
    const json = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (!["127.0.0.1:" + port, "localhost:" + port].includes(host)) return json({ message: "Loopback fixture only" }, 403);
    try {
      // Reject traversal before URL normalization, including encoded and Windows paths.
      const rawPath = (req.url || "").split("?")[0], decoded = decodeURIComponent(rawPath);
      if (!decoded.startsWith("/") || /[\\\0%]/.test(decoded) || decoded.split("/").some(x => x === "." || x === "..")) return json({ message: "Invalid fixture path" }, 400);
      const url = new URL(req.url, `http://${host}`), path = url.pathname;
      if (req.method === "POST" && path === "/fixture/control") {
        evidence.controlsReceived++;
        const rejectControl = (reason, status = 403) => { evidence.controlRejections.push(reason); if (evidence.controlRejections.length > 20) evidence.controlRejections.shift(); return json({ message: "本地控制被拒绝：" + reason }, status); };
        if (req.headers.origin && req.headers.origin !== `http://${host}`) return rejectControl("origin");
        if (!String(req.headers["content-type"] || "").startsWith("application/x-www-form-urlencoded")) return rejectControl("content-type", 415);
        let raw = ""; for await (const part of req) { raw += part; if (raw.length > 1024) return rejectControl("body-size", 413); }
        const body = new URLSearchParams(raw);
        if (body.get("csrf") !== csrf) return rejectControl("csrf");
        const action = body.get("action");
        if (action === "products" || action === "bootstrap") pending[action] = true;
        else if (action === "clear") { pending.products = false; pending.bootstrap = false; }
        else return rejectControl("action", 400);
        evidence.controlsAccepted++;
        if (req.headers.accept === "application/json") return json({ pending });
        res.writeHead(303, { location: "/fixture/" }); return res.end();
      }
      if (req.method !== "GET" && req.method !== "HEAD") { evidence.rejectedWrites++; return json({ message: "国际目录夹具不支持登录或交易写入" }, 403); }
      if (path === "/fixture/evidence") return json({ ...evidence, pending });
      if (path === "/fixture/control.js") { res.writeHead(200, { "content-type": "application/javascript" }); return res.end(catalogControlScript); }
      if (path === "/fixture/" || path === "/fixture") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地商品目录测试控制台</title><style>body{font:16px/1.7 sans-serif;max-width:760px;margin:30px auto;padding:16px}a,button{display:inline-block;margin:8px;padding:10px}form{padding:16px;background:#eee}code{color:#b00}</style><h1>本地商品目录测试控制台</h1><p>仅 127.0.0.1；30 个合成商品：A 手表 27 件、B 配件 3 件。无账号、数据库、真实微信、短信或支付。图片为仓库自带占位图。</p><p><a href="${catalogBase}" target="_blank">打开商城首页</a><a href="${catalogBase}#/pages/category/index" target="_blank">分类页</a><a href="${catalogBase}#/pages/search/index?keyword=A" target="_blank">搜索 A（27 件）</a><a href="${catalogBase}#/pages/search/index?keyword=B" target="_blank">搜索 B（3 件）</a></p><p>复现：搜索 A 后把输入改为 B，不点搜索而点击“加载更多”；应继续 A 第 2 页，不能混入 B。分类页选手表后，回首页点“全部商品”，应恢复全部 30 件。</p><form action="/fixture/control" method="post"><input type="hidden" name="csrf" value="${csrf}"><p>下一次请求故障：商品列表 <code id="products-state">${pending.products ? "已开启一次" : "关闭"}</code>；首页初始化 <code id="bootstrap-state">${pending.bootstrap ? "已开启一次" : "关闭"}</code></p><button type="submit" name="action" value="products">下一次商品列表失败</button><button type="submit" name="action" value="bootstrap">下一次首页初始化失败</button><button type="submit" name="action" value="clear">取消待触发故障</button></form><p id="control-status" role="status" aria-live="polite">尚未提交控制操作</p><p>开启后返回商城操作；失败只消费一次，重试应恢复。控制不会自动刷新正在测试的页面。</p><a href="/fixture/evidence">查看请求计数与分页证据</a><p>checkout=false；此页面不代表真实交易验收。CSP 拦截所有外部资源（包括源码中的外网 logo）。</p><script src="/fixture/control.js" defer></script></html>`);
      }
      if (path === catalogApi + "/storefront/capabilities") return json(capabilities);
      if (path === catalogApi + "/storefront/bootstrap") {
        evidence.bootstrapReads++;
        if (pending.bootstrap) { pending.bootstrap = false; evidence.bootstrapFailures++; return json({ message: "本地测试：首页初始化暂时失败，请重试" }, 503); }
        return json({ banners: [], categories, featured: products.slice(0, 6), configs: { "store.notice": { enabled: true, value: "本地目录测试：所有商品、价格、库存均为合成数据，交易未开放。" } }, referral: null, capabilities });
      }
      if (path === catalogApi + "/storefront/categories") { evidence.categoryReads++; return json(categories); }
      if (path === catalogApi + "/storefront/products") {
        evidence.productLists++;
        const page = Number(url.searchParams.get("page") || 1), pageSize = Number(url.searchParams.get("pageSize") || 24);
        if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return json({ message: "Invalid page" }, 400);
        const keyword = (url.searchParams.get("keyword") || "").slice(0, 100), categoryId = (url.searchParams.get("categoryId") || "").slice(0, 100), sort = url.searchParams.get("sort") || "";
        let result = products.filter(item => (!keyword || item.name.toLowerCase().includes(keyword.toLowerCase())) && (!categoryId || item.categoryId === categoryId));
        if (sort === "sales") result = [...result].sort((a, b) => b.sales - a.sales);
        const items = result.slice((page - 1) * pageSize, page * pageSize), fail = pending.products;
        pending.products = false;
        evidence.requests.push({ page, pageSize, keyword, categoryId, sort: sort.slice(0, 30), total: result.length, ids: fail ? [] : items.map(item => item.id), status: fail ? 503 : 200 });
        if (evidence.requests.length > 100) evidence.requests.shift();
        if (fail) { evidence.productsFailures++; return json({ message: "本地测试：商品列表暂时失败，请重试" }, 503); }
        return json({ items, total: result.length, page, pageSize });
      }
      if (path.startsWith(catalogApi + "/storefront/products/")) {
        evidence.productDetails++;
        const product = products.find(item => item.id === path.slice((catalogApi + "/storefront/products/").length));
        if (!product) return json({ message: "测试商品不存在" }, 404);
        return json({ ...product, status: "PUBLISHED", source: "LOCAL", gallery: [image], detailHtml: "<p>仅本地界面测试；非真实商品，不接受交易。</p>", reviews: [], skus: [{ id: product.id + "-sku", specification: "测试规格", salePriceCents: product.priceCents, stock: product.stock, image, enabled: true }] });
      }
      let root, relative;
      if (path === image) { root = staticRoot; relative = "product-placeholder.svg"; }
      else if (path.startsWith(catalogBase)) { root = buildRoot; relative = decoded.slice(catalogBase.length) || "index.html"; }
      else return json({ message: "本地夹具未提供此入口" }, 404);
      const candidate = resolve(root, relative);
      if (!candidate.startsWith(root + sep)) return json({}, 400);
      let target; try { target = await realpath(candidate); } catch { return json({}, 404); }
      if (!target.startsWith(root + sep) || !(await stat(target)).isFile()) return json({}, 404);
      res.writeHead(200, { "content-type": mime[extname(target)] || "application/octet-stream" });
      res.end(req.method === "HEAD" ? undefined : await readFile(target));
    } catch { if (!res.headersSent) json({ message: "Invalid local fixture request" }, 400); else res.end(); }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 3 && process.argv[2] === "--local-fixture", "Use explicit --local-fixture; this server binds loopback only");
  const server = await createCatalogFixture();
  server.listen(5189, "127.0.0.1", () => console.log("Local-only catalog fixture: http://127.0.0.1:5189/fixture/ (synthetic data; no external services)"));
}
