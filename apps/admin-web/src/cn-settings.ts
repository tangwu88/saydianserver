type SettingRow = Record<string, any>;

export const cnDisplaySettingKeys = [
  "cn_app_display",
  "cn_health_display",
  "cn_module_display",
] as const;

export function groupCnDisplaySettings(rows: SettingRow[]): SettingRow[] {
  const isDisplay = (row: SettingRow) =>
    (cnDisplaySettingKeys as readonly string[]).includes(row.key);
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
    ...(children.find((row) => row.key === cnDisplaySettingKeys[0]) ??
      children[0]),
    key: cnDisplaySettingKeys[0],
    name: "赛电健康 功能设置",
    configuration: "AI 显示 / 只读健康指标 / 百科与商城",
    public: "分项设置",
    updatedAt: latest,
    _products: ["saydian-app-cn"],
    appScope: "赛电健康",
    _unconfigured: false,
    _cnGroup: true,
    _cnSettings: children,
  };
  let inserted = false;
  return rows.flatMap((row) => {
    if (!isDisplay(row)) return [row];
    if (inserted) return [];
    inserted = true;
    return [group];
  });
}
