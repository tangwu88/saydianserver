// Read-only guard regression: never import the executable or access a database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./h5-browser-fixture.mjs", import.meta.url), "utf8");
const cleanup = source.slice(source.lastIndexOf("await prisma.$transaction(async tx => {"));
assert(cleanup.includes("const member = await tx.user.findUnique"));
const firstDelete = cleanup.indexOf("await tx.paymentIntent.deleteMany");
assert(firstDelete > 0);

for (const entity of ["commerceFavorite", "commerceReview"]) {
  test(`cleanup rejects foreign ${entity} inside the same transaction before any delete`, () => {
    const guard = `assert.equal(await tx.${entity}.count({ where: { productId: { in: productIds }, userId: { not: member.id } } }), 0,`;
    const position = cleanup.indexOf(guard);
    assert(position >= 0 && position < firstDelete);
    assert(!cleanup.includes(`tx.${entity}.deleteMany`), "Do not delete foreign references to make a guard pass");
  });
}
test("cleanup keeps serializable isolation, owner markers and explicit opt-in", () => {
  assert(cleanup.includes('isolationLevel: "Serializable"'));
  assert(cleanup.includes("member.nickname === manifest.marker"));
  assert(cleanup.includes("product.erpItemId === own.erpItemId"));
  assert(source.includes('["create", "cleanup"].includes(action)'));
  assert(source.includes('manifest.status === "cleaned"'));
});
