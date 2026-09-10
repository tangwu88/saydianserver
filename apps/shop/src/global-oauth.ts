import { mallOAuthSessionStamp } from "./api";
import { isGlobalMall, mallConfig } from "./realm";
import { consumeOAuthContext, OAUTH_CALLBACK_PATH, type OAuthContext } from "./global-auth-model";

type Callback = { context?: OAuthContext; code?: string; error?: string };
let pending: Callback | null = null;
/** Called before mounting any component or loading remote images. The code only lives in memory. */
export function bridgeGlobalOAuth() {
  if (!isGlobalMall || typeof location === "undefined") return false;
  const url = new URL(location.href);
  const callbackPath = url.pathname === OAUTH_CALLBACK_PATH;
  const hasOAuth = callbackPath || ["code", "state", "error", "error_description"].some(key => url.searchParams.has(key));
  if (!hasOAuth) return false;
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const providerError = url.searchParams.has("error");
  // Never leave credentials in a referrer, navigation history, or reload URL, including failures.
  history.replaceState(history.state, "", mallConfig.publicBase + "#/pages/login/index");
  try {
    const context = consumeOAuthContext(sessionStorage, state);
    if (!callbackPath || providerError || !code || code.length > 1024 || /[\s\x00-\x1f]/.test(code)) throw new Error("微信授权已取消或返回无效，请重新授权");
    if (context.sessionStamp !== mallOAuthSessionStamp()) throw new Error("账号已切换，请重新发起微信授权");
    pending = { context, code };
  } catch (error) { pending = { error: error instanceof Error ? error.message : "微信授权失败，请重试" }; }
  return true;
}
export function takeGlobalOAuthCallback() { const result = pending; pending = null; return result; }
