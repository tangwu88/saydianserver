import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
function harness() {
  const source = readFileSync(new URL("./views/Orders.vue", import.meta.url), "utf8").match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile("orders.ts", source, ts.ScriptTarget.Latest, true), printer = ts.createPrinter();
  const code = ts.transpileModule(ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => printer.printNode(ts.EmitHint.Unspecified, n, ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let logisticsReads = 0;
  const wrap = (data: unknown) => ({ data: { data } });
  const api = { get: vi.fn(async (path: string) => path.endsWith("/processing")
    ? wrap({ state: "READY", erpStatus: "Sent", orderStatus: "SHIPPED", items: [{ id: "event" }] })
    : path.endsWith("/logistics") ? wrap({ items: ++logisticsReads > 1 ? [{ id: "shipment", trackingNo: "SF-SYNTHETIC" }] : [] })
    : wrap({ id: path.split("/").at(-1), status: "WAITING_FULFILLMENT", erpStatus: "WAIT_SELLER_SEND_GOODS" })) };
  const dispose: Array<() => void> = [];
  const deps = { ref, onMounted: vi.fn(), onBeforeUnmount: (f: () => void) => dispose.push(f), api, data: (r: any) => r.data.data, errorMessage: (e: Error) => e.message, setTimeout, clearTimeout };
  const state = new Function(...Object.keys(deps), code + "\nreturn {open,loadProcessing,orders,detail,selectedId,processing,logistics,drawer};")(...Object.values(deps));
  return { ...state, api, dispose, wrap };
}
describe("partner ERP status and logistics refresh", () => {
  it("updates drawer, list and logistics together after processing finishes", async () => {
    const h = harness();h.orders.value = [{ id: "a", status: "WAITING_FULFILLMENT" }];await h.open("a");
    await vi.waitFor(() => expect(h.logistics.value[0]?.trackingNo).toBe("SF-SYNTHETIC"));
    expect(h.detail.value).toMatchObject({ status: "SHIPPED", erpStatus: "Sent" });
    expect(h.orders.value[0]).toMatchObject({ status: "SHIPPED", erpStatus: "Sent" });h.dispose[0]!();
  });
  it("does not overwrite the next order with an earlier order's processing response", async () => {
    const h = harness();let resolve!: (r: any) => void;const fallback = h.api.get.getMockImplementation()!;
    h.api.get.mockImplementation((path: string) => path === "/orders/a/processing" ? new Promise(r => { resolve = r; }) : fallback(path));
    await h.open("a");await h.open("b");
    await vi.waitFor(() => expect(h.detail.value.id).toBe("b"));
    resolve(h.wrap({ state: "READY", erpStatus: "Cancelled", orderStatus: "CANCELLED", items: [] }));
    await Promise.resolve();await Promise.resolve();
    expect(h.detail.value.id).toBe("b");expect(h.detail.value.erpStatus).not.toBe("Cancelled");h.dispose[0]!();
  });
  it("polls a pending ERP job and then refreshes its real shipment", async () => {
    vi.useFakeTimers();const h = harness();let reads = 0;const fallback = h.api.get.getMockImplementation()!;
    try {
      h.api.get.mockImplementation((path: string) => path.endsWith("/processing") && ++reads === 1
        ? Promise.resolve(h.wrap({ state: "PENDING", erpStatus: "WaitConfirm", items: [] })) : fallback(path));
      await h.open("a");await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2500);
      expect(h.detail.value.erpStatus).toBe("Sent");expect(h.logistics.value[0]?.trackingNo).toBe("SF-SYNTHETIC");
    } finally { h.dispose[0]!();vi.useRealTimers(); }
  });
});
