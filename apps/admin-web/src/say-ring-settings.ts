type SettingRow = Record<string, any>;

export const sayRingDisplaySettingKeys = [
  "say_ring_app_display",
  "say_ring_ios_health_display",
  "say_ring_ios_module_display",
] as const;

export function groupSayRingDisplaySettings(rows: SettingRow[]): SettingRow[] {
  const isDisplay = (row: SettingRow) =>
    (sayRingDisplaySettingKeys as readonly string[]).includes(row.key);
  const children = rows.filter(isDisplay);
  if (!children.length) return rows;
  const latest =
    children
      .map((row) => row.updatedAt)
      .filter(
        (value) =>
          typeof value === "string" && Number.isFinite(Date.parse(value)),
      )
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const group: SettingRow = {
    ...(children.find((row) => row.key === sayRingDisplaySettingKeys[0]) ??
      children[0]),
    key: sayRingDisplaySettingKeys[0],
    name: "Say Ring 功能设置",
    configuration: "AI 显示 / 只读健康指标 / 百科与商城",
    public: "分项设置",
    updatedAt: latest,
    _products: ["say-ring"],
    appScope: "Say Ring",
    _unconfigured: false,
    _sayRingGroup: true,
    _sayRingSettings: children,
  };
  let inserted = false;
  return rows.flatMap((row) => {
    if (!isDisplay(row)) return [row];
    if (inserted) return [];
    inserted = true;
    return [group];
  });
}
