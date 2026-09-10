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
  set: (key: string, value: unknown) => uni.setStorageSync(mallStorageKey(key), value),
  remove: (key: string) => uni.removeStorageSync(mallStorageKey(key)),
};
export const globalCommerceNotice = "国际版独立服务：可浏览商品及登录国际账号；购物、支付、员工推广和小程序暂未开放。";
