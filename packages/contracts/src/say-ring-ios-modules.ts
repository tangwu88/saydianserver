export const sayRingIosModuleSettingKey = "say_ring_ios_module_display";
export const sayRingModuleKeys = ["health_library", "mall"] as const;
export type SayRingModule = (typeof sayRingModuleKeys)[number];
export interface SayRingIosModuleDisplay {
  schemaVersion: 1;
  modules: Record<SayRingModule, boolean>;
}

export function parseSayRingIosModuleDisplay(input: unknown): SayRingIosModuleDisplay {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("模块显示配置必须为对象");
  const value = input as Partial<SayRingIosModuleDisplay>;
  if (value.schemaVersion !== 1 || Object.keys(value).length !== 2 ||
      Object.keys(value).some(key => !["schemaVersion", "modules"].includes(key)))
    throw new Error("模块显示配置版本或字段无效");
  const modules = value.modules;
  if (!modules || typeof modules !== "object" || Array.isArray(modules) ||
      Object.keys(modules).length !== sayRingModuleKeys.length ||
      Object.keys(modules).some(key => !sayRingModuleKeys.includes(key as SayRingModule)) ||
      sayRingModuleKeys.some(key => typeof modules[key] !== "boolean"))
    throw new Error("健康百科和商城必须分别设置为开启或关闭，不允许其他功能");
  return { schemaVersion: 1, modules: { health_library: modules.health_library, mall: modules.mall } };
}

export function sayRingIosModuleDisplayOrClosed(input?: unknown): SayRingIosModuleDisplay {
  try { return parseSayRingIosModuleDisplay(input); }
  catch { return { schemaVersion: 1, modules: { health_library: false, mall: false } }; }
}
