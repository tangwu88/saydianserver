import { businessWritesPaused, cutoverFlag } from "@saydian/app-contracts";
import { isGlobalRealm } from "../common/deployment-realm";
import { globalError } from "./global-identity";

export const GLOBAL_WECHAT_CALLBACK_PATH = "/global/saidian-mall/oauth/callback";

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
