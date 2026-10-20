import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
function harness(canSync = true) {
  const source = readFileSync(new URL("./components/OrderErpPanel.vue", import.meta.url), "utf8").match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile("panel.ts", source, ts.ScriptTarget.Latest, true), printer = ts.createPrinter();
  const code = ts.transpileModule(ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => printer.printNode(ts.EmitHint.Unspecified, n, ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const props = { order: { id: "order-1", erpOrderId: "123", erpStatus: "WaitConfirm" }, canSync }, emit = vi.fn();
  const mounts: Array<() => void> = [], dispose: Array<() => void> = [];
  const api = { get: vi.fn(async () => ({ data: { data: { state: "READY", erpStatus: "Sent", orderStatus: "SHIPPED", items: [], shipments: [{ trackingNo: "SYNTHETIC" }] } } })), post: vi.fn(async () => ({})) };
  const deps = { ref, defineProps: () => props, defineEmits: () => emit, onMounted: (f: () => void) => mounts.push(f), onBeforeUnmount: (f: () => void) => dispose.push(f), api,
    responseData: (r: any) => r.data.data, readableError: (e: Error) => e.message, setTimeout, clearTimeout };
  const state = new Function(...Object.keys(deps), code + "\nreturn {load,refresh,snapshot,busy,error,expanded};")(...Object.values(deps));
  return { ...state, api, props, emit, mounts, dispose };
}
describe("order ERP panel lifecycle", () => {
  it("loads actual status on open and exposes logs after an explicit click", async () => {
    const h = harness();h.mounts[0]!();
    await vi.waitFor(() => expect(h.snapshot.value.erpStatus).toBe("Sent"));
    expect(h.api.post).toHaveBeenCalledWith("/commerce-orders/order-1/erp-sync", {});
    expect(h.expanded.value).toBe(false);
    await h.refresh();expect(h.expanded.value).toBe(true);expect(h.emit).toHaveBeenCalledWith("synced", expect.objectContaining({ orderStatus: "SHIPPED" }));
  });
  it("never queues a query for a read-only viewer", async () => {
    const h = harness(false);await h.refresh();
    expect(h.api.post).not.toHaveBeenCalled();expect(h.api.get).toHaveBeenCalledWith("/commerce-orders/order-1/erp");
  });
  it("does not emit an old order's response after the drawer is closed", async () => {
    const h = harness();let resolve!: (r: any) => void;
    h.api.get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = h.load();h.dispose[0]!();resolve({ data: { data: { state: "READY", erpStatus: "Sent" } } });await pending;
    expect(h.emit).not.toHaveBeenCalled();expect(h.snapshot.value.erpStatus).toBe("WaitConfirm");
  });
  it("retains prior status and permits retry if the server refuses the refresh", async () => {
    const h = harness();h.api.post.mockRejectedValueOnce(Error("not configured"));await h.refresh();
    expect(h.error.value).toBe("not configured");expect(h.snapshot.value.erpStatus).toBe("WaitConfirm");expect(h.busy.value).toBe(false);
  });
});
