// Explicitly scoped QA: disabled synthetic categories and one unpublished article.
// Run in the international API container; credentials arrive only through stdin.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";

assert(process.argv.includes("--synthetic-content"), "Synthetic-content opt-in required");
assert(process.env.APP_REALM === "global");
assert(new URL(process.env.DATABASE_URL).pathname === "/saydian_global");
setDefaultResultOrder("ipv4first");
const { PrismaClient } = createRequire("/workspace/apps/api/package.json")("@prisma/client");
const prisma = new PrismaClient();
let input = "";
for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input); input = "";
const marker = `QA-category-number-${randomUUID()}`;
const base = "https://app.saydian.cn/global/api/saydian-app/admin/v1";
let token;
let checks = 0;
let syntheticRemoved = false;
function check(value, message) { assert(value, message); checks++; }
async function call(path, method = "GET", body) {
  const response = await fetch(base + path, { method, redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  check(response.status === (method === "POST" ? 201 : 200), `${method} ${path}: HTTP ${response.status}`);
  return (await response.json()).data;
}
try {
  token = (await call("/auth/login", "POST", credentials)).token;
  credentials.password = "";
  const before = await call("/article-categories");
  check(before.every(row => /^[1-9]\d*$/.test(row.categoryNo)), "All existing categories have numeric IDs");
  check(new Set(before.map(row => row.categoryNo)).size === before.length, "Existing display IDs are unique");
  const first = await call("/article-categories", "POST", { name: marker, enabled: false, locale: "en", sort: 0 });
  const second = await call("/article-categories", "POST", { name: marker, enabled: false, locale: "en", sort: 0, parentId: first.id });
  check(first.id !== second.id && first.categoryNo !== second.categoryNo, "Same-name categories get independent IDs");
  check(/^[1-9]\d*$/.test(first.categoryNo) && /^[1-9]\d*$/.test(second.categoryNo), "New IDs are numeric");
  const snapshots = await Promise.all([call("/article-categories"), call("/article-categories"), call("/article-categories")]);
  for (const rows of snapshots) {
    check(rows.find(row => row.id === first.id)?.categoryNo === first.categoryNo, "Parallel reads preserve display ID");
    check(before.every(old => rows.find(row => row.id === old.id)?.categoryNo === old.categoryNo), "Existing IDs unchanged");
  }
  const edited = await call(`/article-categories/${second.id}`, "PATCH", {
    name: marker + "-edited", enabled: false, locale: "en", sort: 10, parentId: first.id, categoryNo: "999999",
  });
  check(edited.id === second.id && edited.categoryNo === second.categoryNo && edited.parentId === first.id, "Rename/reorder keeps ID and parent; forged number ignored");
  const article = await call("/articles", "POST", { title: marker, status: "DRAFT", locale: "en", categoryId: second.id, contentHtml: "<p>Synthetic category association check.</p>" });
  check(article.categoryId === second.id && article.status === "DRAFT", "Article persists UUID category relationship");
  const loaded = (await call("/articles")).find(row => row.id === article.id);
  check(loaded?.category?.id === second.id && loaded.category.name === edited.name, "Article association still resolves after editing");
} finally {
  // Only this unpredictable run marker is disposable; existing content is untouched.
  await prisma.$transaction(async tx => {
    const owned = await tx.articleCategory.findMany({ where: { name: { in: [marker, marker + "-edited"] } }, select: { id: true } });
    const ids = owned.map(row => row.id);
    await tx.article.deleteMany({ where: { title: marker, status: "DRAFT", categoryId: { in: ids } } });
    await tx.articleCategory.updateMany({ where: { id: { in: ids }, parentId: { in: ids } }, data: { parentId: null } });
    await tx.articleCategory.deleteMany({ where: { id: { in: ids }, name: { in: [marker, marker + "-edited"] } } });
    // Retain allocated mapping tombstones: numbers must never be recycled.
  });
  syntheticRemoved = await prisma.articleCategory.count({ where: { name: { in: [marker, marker + "-edited"] } } }) === 0
    && await prisma.article.count({ where: { title: marker } }) === 0;
  if (token) await call("/auth/logout", "POST", {});
  await prisma.$disconnect();
  check(syntheticRemoved, "This run's synthetic content must be fully removed");
  console.log(JSON.stringify({ checks, syntheticRemoved }));
}
