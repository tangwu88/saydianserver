import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
function harness() {
  const source = readFileSync(
    new URL("./components/ProductErpAssignmentRepair.vue", import.meta.url),
    "utf8",
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile(
      "repair.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
    printer = ts.createPrinter();
  const code = ts.transpileModule(
    ast.statements
      .filter((n) => !ts.isImportDeclaration(n))
      .map((n) => printer.printNode(ts.EmitHint.Unspecified, n, ast))
      .join("\n"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const api = {
    post: vi.fn(async (_url: string, body: any) => ({
      data: {
        data:
          body.action === "preview"
            ? { changed: 1, fingerprint: "a".repeat(64), rows: [] }
            : { changed: 1, product: { id: "source" }, newDrafts: ["R7y"] },
      },
    })),
  };
  const confirm = vi.fn(async () => {}),
    emit = vi.fn(),
    dispose: Array<() => void> = [];
  const deps = {
    ref,
    onBeforeUnmount: (fn: () => void) => dispose.push(fn),
    defineProps: () => ({ productId: "source" }),
    defineEmits: () => emit,
    api,
    responseData: (r: any) => r.data.data,
    readableError: String,
    ElMessage: { success: vi.fn(), error: vi.fn() },
    ElMessageBox: { confirm },
  };
  const state = new Function(
    ...Object.keys(deps),
    `${code}\nreturn { inspect, apply, preview, visible };`,
  )(...Object.values(deps));
  return { ...state, api, confirm, emit, dispose };
}
describe("ERP assignment preview confirmation", () => {
  it("never applies during preview, then submits only the approved fingerprint", async () => {
    const h = harness();
    await h.inspect();
    expect(h.api.post).toHaveBeenCalledExactlyOnceWith(
      "/commerce-products/source/erp-assignment",
      { action: "preview" },
    );
    await h.apply();
    expect(h.confirm).toHaveBeenCalled();
    expect(h.api.post).toHaveBeenLastCalledWith(
      "/commerce-products/source/erp-assignment",
      { action: "apply", fingerprint: "a".repeat(64) },
    );
    expect(h.emit).toHaveBeenCalledWith("saved", { id: "source" });
  });
  it("cancellation and closing the source component cannot apply a pending confirmation", async () => {
    const h = harness();
    await h.inspect();
    h.confirm.mockRejectedValueOnce("cancel");
    await h.apply();
    expect(h.api.post).toHaveBeenCalledTimes(1);
    h.dispose[0]!();
    await h.apply();
    expect(h.api.post).toHaveBeenCalledTimes(1);
  });
});
