import { realmKey, resolveMallConfig } from "./realm-config";
let miniProgram = false;
/* #ifdef MP-WEIXIN */
miniProgram = true;
/* #endif */
export const mallConfig = resolveMallConfig(import.meta.env, miniProgram);
export const isGlobalMall = mallConfig.realm === "global";
export const mallStorageKey = (key: string) => realmKey(key, mallConfig.realm);
export const mallStorage = {
  get: (key: string): any => uni.getStorageSync(mallStorageKey(key)),
  has: (key: string): boolean => uni.getStorageInfoSync().keys.includes(mallStorageKey(key)),
  set: (key: string, value: unknown) => uni.setStorageSync(mallStorageKey(key), value),
  remove: (key: string) => uni.removeStorageSync(mallStorageKey(key)),
};
export const globalCommerceNotice = "此功能暂未开放，请稍后再试。";
