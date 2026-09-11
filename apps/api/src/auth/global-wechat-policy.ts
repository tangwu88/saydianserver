import { businessWritesPaused, cutoverFlag } from "@saydian/app-contracts";
import { isGlobalRealm } from "../common/deployment-realm";
import { globalError } from "./global-identity";

export const GLOBAL_WECHAT_CALLBACK_PATH = "/global/saidian-mall/oauth/callback";
export const H5_PHONE_TEST_SESSION_PREFIX = "h5-phone-test:";
export function isH5PhoneTestSession(jti: unknown) { return typeof jti === "string" && jti.startsWith(H5_PHONE_TEST_SESSION_PREFIX); }
export function globalWechatPhoneTestEnabled() { return isGlobalRealm() && cutoverFlag(process.env.GLOBAL_WECHAT_PHONE_TEST_ENABLED) && !globalWechatH5Reason(); }
export function requireGlobalWechatPhoneTest() {
  requireGlobalWechatH5();
  if (!globalWechatPhoneTestEnabled()) throw globalError(403, "phone_test_disabled", "Temporary phone registration is disabled. Verify your phone through an available channel.");
}

export function globalWechatH5Reason(): string | null {
  if (!cutoverFlag(process.env.GLOBAL_WECHAT_H5_ENABLED)) return "WeChat sign-in has not been enabled.";
  if (cutoverFlag(process.env.H5_DEMO_ENABLED)) return "External sign-in is unavailable in the demo environment.";
  if (businessWritesPaused(process.env)) return "Sign-in is temporarily unavailable during maintenance.";
  return null;
}

export function requireGlobalWechatH5() {
  if (!isGlobalRealm()) throw globalError(404, "not_found", "This feature is unavailable.");
  const reason = globalWechatH5Reason();
  if (reason) throw globalError(503, "wechat_h5_unavailable", reason);
}
