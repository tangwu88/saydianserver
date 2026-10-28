import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
function harness() {
  const source = readFileSync(
    new URL("./components/PartnerCustomerImages.vue", import.meta.url),
    "utf8",
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile(
      "images.ts",
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
    get: vi.fn(async () => ({ data: { data: { items: [], total: 0 } } })),
    post: vi.fn(async () => ({})),
  };
  let dispose = () => {};
  const url = {
    createObjectURL: vi.fn(() => "blob:private"),
    revokeObjectURL: vi.fn(),
  };
  const deps = {
    ref,
    defineProps: () => ({ partner: { id: "synthetic", name: "合成伙伴" } }),
    defineEmits: () => vi.fn(),
    onMounted: vi.fn(),
    onBeforeUnmount: (fn: () => void) => {
      dispose = fn;
    },
    api,
    responseData: (r: any) => r.data.data,
    readableError: () => "合成上传失败",
    URL: url,
  };
  const state = new Function(
    ...Object.keys(deps),
    code +
      "\nreturn { load, choose, upload, preview, rows, pending, error, uploadResults };",
  )(...Object.values(deps));
  return { ...state, api, url, dispose: () => dispose() };
}
describe("partner customer image batch actions", () => {
  it("saves each selected picture and retries only failed uploads", async () => {
    const h = harness();
    const files = [
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.jpg", { type: "image/jpeg" }),
    ];
    h.choose({ target: { files, value: "selection" } });
    h.api.post
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("offline"));
    await h.upload();
    expect(h.pending.value).toEqual([files[1]]);
    expect(h.uploadResults.value).toEqual([
      { name: "one.png" },
      { name: "two.jpg", error: "合成上传失败" },
    ]);
    await h.upload();
    expect(h.api.post).toHaveBeenCalledTimes(3);
    expect(h.api.post.mock.calls[2][1].get("file").name).toBe("two.jpg");
    expect(h.pending.value).toEqual([]);
  });
  it("rejects oversize batches before uploading", () => {
    const h = harness();
    h.choose({
      target: {
        files: Array(21).fill(new File(["x"], "x.png", { type: "image/png" })),
        value: "",
      },
    });
    expect(h.pending.value).toEqual([]);
    expect(h.error.value).toContain("最多选择20张");
    expect(h.api.post).not.toHaveBeenCalled();
  });
  it("discards late preview responses after closing the dialog", async () => {
    const h = harness();
    let resolve!: (value: any) => void;
    h.api.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const row = { id: "image", originalName: "private", createdAt: "" };
    const task = h.preview(row);
    h.dispose();
    resolve({ data: new Blob(["image"]) });
    await task;
    expect(h.url.createObjectURL).not.toHaveBeenCalled();
  });
});
