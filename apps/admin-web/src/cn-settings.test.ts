import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  groupCnDisplaySettings,
  cnDisplaySettingKeys,
} from "./cn-settings";

const [aiKey, healthKey, moduleKey] = cnDisplaySettingKeys;
const initial = () => [
  {
    key: aiKey,
    value: { hideAi: true, sleepAiEnabled: true },
    updatedAt: "2026-10-18T01:00:00Z",
  },
  {
    key: healthKey,
    value: { metrics: { heart_rate: true } },
    updatedAt: "2026-10-18T02:00:00Z",
  },
  {
    key: moduleKey,
    value: { modules: { mall: true } },
    updatedAt: "2026-10-18T03:00:00Z",
  },
];

function harness() {
  const sourceRows = initial();
  const sfc = readFileSync(
    new URL("./components/CnSettingsPanel.vue", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "panel.ts",
    sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const printer = ts.createPrinter();
  const code = ts.transpileModule(
    ast.statements
      .filter((node) => !ts.isImportDeclaration(node))
      .map((node) => printer.printNode(ts.EmitHint.Unspecified, node, ast))
      .join("\n"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const api = {
    patch: vi.fn(async () => ({})),
    get: vi.fn(async () => ({ data: { data: initial() } })),
  };
  const emit = vi.fn(),
    messages = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  let dispose = () => {};
  const deps = {
    ref,
    defineProps: () => ({ settings: sourceRows }),
    defineEmits: () => emit,
    onBeforeUnmount: (callback: () => void) => {
      dispose = callback;
    },
    api,
    responseData: (response: any) => response.data.data,
    readableError: () => "保存失败",
    ElMessage: messages,
  };
  const panel = new Function(
    ...Object.keys(deps),
    code +
      "; return { saveAi, refresh, ai, settings, busy, refreshing, activeTab };",
  )(...Object.values(deps));
  return {
    ...panel,
    sourceRows,
    api,
    emit,
    messages,
    dispose: () => dispose(),
  };
}

describe("赛电健康 unified settings entry", () => {
  it("combines exactly the three display settings without mutating persisted rows or grouping downloads and maps", () => {
    const others = [
      { key: "global_support" },
      { key: "say_ring_app_update" },
      { key: "say_ring_map" },
      { key: "say_ring_app_display" },
    ];
    const rows = [others[0]!, ...initial(), ...others.slice(1)];
    const before = structuredClone(rows);
    const listed = groupCnDisplaySettings(rows);
    expect(listed.map((row) => row.key)).toEqual([
      "global_support",
      aiKey,
      "say_ring_app_update",
      "say_ring_map",
      "say_ring_app_display",
    ]);
    expect(listed[1]).toMatchObject({
      name: "赛电健康 功能设置",
      _products: ["saydian-app-cn"],
      public: "分项设置",
      updatedAt: "2026-10-18T03:00:00Z",
    });
    expect(listed[1]!._cnSettings.map((row: any) => row.key)).toEqual(
      cnDisplaySettingKeys,
    );
    expect(rows).toEqual(before);
    expect(groupCnDisplaySettings(others)).toBe(others);
  });

  it("opens without writing and saves only AI fields while retaining edits in other sections", async () => {
    const h = harness();
    expect(h.ai.value).toEqual({ hideAi: true, sleepAiEnabled: true });
    expect(h.api.patch).not.toHaveBeenCalled();
    expect(h.api.get).not.toHaveBeenCalled();
    const health = h.settings.value[healthKey];
    h.ai.value.hideAi = false;
    h.api.get.mockResolvedValueOnce({
      data: {
        data: [
          {
            key: aiKey,
            value: { hideAi: false, sleepAiEnabled: true },
            updatedAt: "2026-10-19T00:00:00Z",
          },
          {
            key: healthKey,
            value: { metrics: { heart_rate: false } },
            updatedAt: "2026-10-19T00:00:00Z",
          },
        ],
      },
    });
    await h.saveAi();
    expect(h.api.patch).toHaveBeenCalledExactlyOnceWith(`/settings/${aiKey}`, {
      value: { hideAi: false, sleepAiEnabled: true },
      public: true,
    });
    expect(h.settings.value[healthKey]).toBe(health);
    expect(h.settings.value[aiKey].updatedAt).toBe("2026-10-19T00:00:00Z");
    expect(h.sourceRows[0]!.value.hideAi).toBe(true);
    h.ai.value.sleepAiEnabled = false;
    await h.refresh(moduleKey);
    expect(h.ai.value.sleepAiEnabled).toBe(false);
    expect(h.emit).toHaveBeenCalledWith("saved");
  });

  it("keeps errors visible and does not replace an existing section with a failed readback", async () => {
    const h = harness();
    h.api.patch.mockRejectedValueOnce(new Error("conflict"));
    await h.saveAi();
    expect(h.messages.error).toHaveBeenCalledWith("保存失败");
    expect(h.emit).not.toHaveBeenCalled();
    expect(h.api.get).not.toHaveBeenCalled();
    const health = h.settings.value[healthKey];
    h.api.get.mockRejectedValueOnce(new Error("network"));
    await h.refresh(healthKey);
    expect(h.messages.warning).toHaveBeenCalledOnce();
    expect(h.settings.value[healthKey]).toBe(health);
    expect(h.refreshing.value[healthKey]).toBe(false);
    expect(h.busy.value).toBe(false);
  });

  it("ignores late save responses after closing and prevents duplicate AI saves", async () => {
    const h = harness();
    let complete!: (value: {}) => void;
    h.api.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = h.saveAi();
    await h.saveAi();
    expect(h.api.patch).toHaveBeenCalledOnce();
    h.dispose();
    complete({});
    await pending;
    await h.refresh(healthKey);
    expect(h.api.get).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });
});
