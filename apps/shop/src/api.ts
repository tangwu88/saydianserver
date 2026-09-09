import { safeMallRoute } from "./commerce-model";
let sessionGeneration = 0;
let loginRedirecting = false;
let defaultApiBase = "/api/saidian-mall/v1";
/* #ifdef MP-WEIXIN */
defaultApiBase = "https://stest.saydian.cn/api/saidian-mall/v1";
/* #endif */
const API_BASE = (import.meta.env.VITE_API_BASE || defaultApiBase).replace(
  /\/$/,
  "",
);
let miniLoginPromise: Promise<any> | null = null;
let refreshPromise: Promise<any> | null = null;
export const COMMERCE_CONSENT_VERSION = "commerce-legal-v1";

const SESSION_REVISION = "saidian-session-revision";
const SESSION_COMMIT = "saidian-session-commit";
const loginSnapshots = new WeakMap<object, string>();
let observedSession = "";
let sessionSyncStarted = false;

function h5Document(): boolean {
  return typeof window !== "undefined" && !isWeixinMiniProgram();
}
function lockManager(): LockManager | undefined {
  return h5Document() && typeof navigator !== "undefined" ? navigator.locks : undefined;
}
function withSessionLock<T>(operation: () => T | Promise<T>): T | Promise<T> {
  if (!h5Document()) return operation();
  const locks = lockManager();
  if (!locks?.request) throw new Error("当前浏览器不支持安全的跨标签登录，请使用 HTTPS 或 localhost 的新版浏览器");
  return Promise.resolve(locks.request("saidian-mall:session:v1", { mode: "exclusive" }, operation));
}
/** Lock the entire read/recover/create transaction, never just key generation. */
export async function withMallCheckoutLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!h5Document()) return operation();
  const locks = lockManager();
  if (!locks?.request) throw new Error("当前浏览器不支持安全下单；请使用 HTTPS 或 localhost 的新版浏览器，原下单草稿已保留");
  return locks.request("saidian-mall:checkout:v1", { mode: "exclusive", ifAvailable: true }, lock => {
    if (!lock) throw new Error("另一个商城标签正在下单，请等待完成后重试；请勿重新选择商品");
    return operation();
  });
}
function stableSession(): boolean {
  return String(uni.getStorageSync(SESSION_REVISION) || "") === String(uni.getStorageSync(SESSION_COMMIT) || "");
}
function identityStamp(): string {
  return JSON.stringify([uni.getStorageSync(SESSION_COMMIT) || "", uni.getStorageSync("saidian-user")?.id || "", !!uni.getStorageSync("saidian-token")]);
}
export function mallSessionStamp(): string {
  return JSON.stringify([sessionGeneration, uni.getStorageSync(SESSION_REVISION) || "", identityStamp()]);
}
function currentSession(stamp: string): boolean {
  return stableSession() && stamp === mallSessionStamp();
}
function changedSession(): Error { return new Error("账号已切换，请重新加载"); }
function commitSession(operation: () => void): void {
  const revision = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  sessionGeneration++;
  refreshPromise = null;
  // Mark writes in progress before touching credentials; readers reject mixed snapshots.
  uni.setStorageSync(SESSION_REVISION, revision);
  operation();
  uni.setStorageSync(SESSION_COMMIT, revision);
  observedSession = identityStamp();
}
/** Only reset this document. Never remove the other tab's newly committed storage. */
export function startMallSessionSync(): void {
  if (!h5Document() || sessionSyncStarted) return;
  sessionSyncStarted = true;
  observedSession = identityStamp();
  const synchronize = () => {
    if (!stableSession()) return;
    const next = identityStamp();
    if (next === observedSession) return;
    observedSession = next;
    sessionGeneration++;
    refreshPromise = null;
    loginRedirecting = false;
    uni.reLaunch({ url: "/pages/profile/index" });
  };
  window.addEventListener("storage", event => {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    if (event.key === null || [SESSION_COMMIT, "saidian-user", "saidian-token"].includes(event.key)) synchronize();
  });
  window.addEventListener("pageshow", synchronize);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") synchronize(); });
}


function isWeixinMiniProgram(): boolean {
  /* #ifdef MP-WEIXIN */
  return true;
  /* #endif */
  return false;
}

export async function ensureMiniProgramSession(force = false): Promise<any> {
  if (!isWeixinMiniProgram()) throw new Error("当前环境不是微信小程序");
  if (!force && uni.getStorageSync("saidian-token"))
    return uni.getStorageSync("saidian-user");
  if (miniLoginPromise) return miniLoginPromise;
  const login = (async () => {
    const result: any = await new Promise((resolve, reject) =>
      uni.login({ provider: "weixin", success: resolve, fail: reject }),
    );
    if (!result.code) throw new Error("未获取到微信登录凭证");
    const response: any = await api("/auth/wechat/mini", {
      method: "POST",
      data: {
        code: result.code,
        consentVersion: COMMERCE_CONSENT_VERSION,
        referralCode: String(uni.getStorageSync("saidian-ref") || ""),
      },
    });
    await saveMallSession(response);
    return response.user;
  })();
  miniLoginPromise = login;
  try {
    return await login;
  } finally {
    if (miniLoginPromise === login) miniLoginPromise = null;
  }
}
export const productPlaceholder = "";
export async function api<T = any>(
  path: string,
  options: {
    method?: UniApp.RequestOptions["method"];
    data?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
    sessionStamp?: string;
  } = {},
): Promise<T> {
  let expectedStamp = options.sessionStamp ?? mallSessionStamp();
  if (options.auth && sessionSyncStarted && identityStamp() !== observedSession) throw changedSession();
  let token = String(uni.getStorageSync("saidian-token") || "");
  if (options.auth && !token && isWeixinMiniProgram()) {
    await ensureMiniProgramSession();
    if (options.sessionStamp === undefined) expectedStamp = mallSessionStamp();
    token = String(uni.getStorageSync("saidian-token") || "");
  }
  if (options.auth && !token) { requireLogin(); throw new Error("请先登录"); }
  if ((options.auth || path.startsWith("/auth/")) && !currentSession(expectedStamp)) throw changedSession();
  return request<T>(path, options, token, true, expectedStamp);
}

function request<T>(
  path: string,
  options: {
    method?: UniApp.RequestOptions["method"];
    data?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
    sessionStamp?: string;
  },
  token: string,
  allowRefresh: boolean,
  requestStamp: string,
): Promise<T> {
  const sessionSensitive = options.auth || path.startsWith("/auth/");
  if (sessionSensitive && !stableSession()) return Promise.reject(changedSession());
  return new Promise((resolve, reject) => {
    const requestOptions: UniApp.RequestOptions = {
      url: `${API_BASE}${path}`,
      method: options.method ?? "GET",
      timeout: 15000,
      header: {
        "content-type": "application/json",
        ...(options.auth && token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      async success(response) {
        // Public responses also fence mixed Promise.all loads containing private data.
        if (!currentSession(requestStamp)) { reject(changedSession()); return; }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (!options.auth && path.startsWith("/auth/") && response.data && typeof response.data === "object") loginSnapshots.set(response.data, requestStamp);
          resolve(response.data as T);
        }
        else {
          const message = (response.data as any)?.message ?? "请求失败";
          if (response.statusCode === 401 && options.auth && allowRefresh) {
            try {
              const session = await refreshMallSession(token, requestStamp);
              if (!currentSession(requestStamp)) { reject(changedSession()); return; }
              resolve(await request<T>(path, options, session.token, false, requestStamp));
              return;
            } catch (error) {
              if ([401, 403].includes((error as any)?.status) && currentSession(requestStamp)) {
                try {
                  await clearMallSession(true, requestStamp);
                  if (!uni.getStorageSync("saidian-token")) requireLogin();
                } catch (clearError) { reject(clearError); return; }
              }
              if (!currentSession(requestStamp) && uni.getStorageSync("saidian-token")) { reject(changedSession()); return; }
              // A lock/network failure does not prove that the shared session expired.
              if (![401, 403].includes((error as any)?.status)) { reject(error); return; }
            }
          }
          reject(Object.assign(new Error(Array.isArray(message) ? message.join("；") : message), { status: response.statusCode }));
        }
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络连接失败"));
      },
    };
    if (options.data !== undefined) {
      requestOptions.data = options.data as Exclude<
        UniApp.RequestOptions["data"],
        undefined
      >;
    }
    uni.request(requestOptions);
  });
}

async function refreshMallSession(failedToken: string, requestStamp: string): Promise<any> {
  if (refreshPromise) return refreshPromise;
  const pending = Promise.resolve(withSessionLock(() => {
    if (!currentSession(requestStamp)) throw changedSession();
    const token = String(uni.getStorageSync("saidian-token") || "");
    const refreshToken = String(uni.getStorageSync("saidian-refresh-token") || "");
    const user = uni.getStorageSync("saidian-user");
    // A previous lock holder already rotated the token: reuse its result.
    if (token && token !== failedToken) return { token, refreshToken, user };
    if (!refreshToken) throw Object.assign(new Error("登录已失效"), { status: 401 });
    return new Promise<any>((resolve, reject) => uni.request({
      url: API_BASE + "/auth/refresh", method: "POST", timeout: 15000,
      data: { refreshToken }, header: { "content-type": "application/json" },
      success(response) {
        if (!currentSession(requestStamp)) { reject(changedSession()); return; }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const session = response.data as any;
          if (!session?.token || !session?.refreshToken || !session?.user?.id || session.user.id !== user?.id) {
            reject(new Error("刷新登录响应不完整或账号不匹配")); return;
          }
          uni.setStorageSync("saidian-token", session.token);
          uni.setStorageSync("saidian-refresh-token", session.refreshToken);
          uni.setStorageSync("saidian-user", session.user);
          resolve(session); return;
        }
        reject(Object.assign(new Error("登录已失效"), { status: response.statusCode }));
      },
      fail: error => reject(new Error(error.errMsg || "网络连接失败")),
    }));
  }));
  refreshPromise = pending;
  try { return await pending; }
  finally { if (refreshPromise === pending) refreshPromise = null; }
}

export function clearMallSession(preserveCheckout = false, expectedStamp = mallSessionStamp()): void | Promise<void> {
  const clear = () => {
    // Under the lock, explicit logout can also recover an interrupted credential commit.
    if (expectedStamp !== mallSessionStamp()) return;
    commitSession(() => {
      uni.removeStorageSync("saidian-token");
      uni.removeStorageSync("saidian-refresh-token");
      uni.removeStorageSync("saidian-user");
      if (!preserveCheckout) clearCheckoutState();
      uni.removeStorageSync("saidian-ref");
      uni.removeStorageSync("saidian-post-login-route");
    });
  };
  // Unsupported browsers cannot start new login/refresh operations, but can still log out.
  if (h5Document() && !lockManager()?.request) return clear();
  return withSessionLock(clear);
}
export function clearCheckoutState(): void {
  for (const key of ["checkout-items","checkout-address","checkout-draft","checkout-owner","checkout-pending","checkout-cart-ids"]) uni.removeStorageSync(key);
}
export function saveMallSession(session: any): void | Promise<void> {
  if (!session?.token || !session?.user?.id) throw new Error("登录响应不完整");
  const expected = loginSnapshots.get(session) ?? mallSessionStamp();
  return withSessionLock(() => {
    if (!currentSession(expected)) throw changedSession();
    const previous = uni.getStorageSync("saidian-user");
    const owner = previous?.id || uni.getStorageSync("checkout-owner");
    commitSession(() => {
      if (owner && owner !== session.user.id) { clearCheckoutState(); uni.removeStorageSync("saidian-ref"); }
      uni.setStorageSync("saidian-token", session.token);
      uni.setStorageSync("saidian-refresh-token", session.refreshToken);
      uni.setStorageSync("saidian-user", session.user);
      uni.setStorageSync("checkout-owner", session.user.id);
    });
    loginRedirecting = false;
  });
}
export function requireLogin(next?: string): boolean {
  if (uni.getStorageSync("saidian-token")) return true;
  const pages = getCurrentPages();
  const page = pages[pages.length - 1] as any;
  const query = Object.entries(page?.options || {}).map(([key,value]) => encodeURIComponent(key)+"="+encodeURIComponent(String(value))).join("&");
  const route = next || (page?.route ? "/" + page.route + (query ? "?" + query : "") : "/pages/profile/index");
  if (!route.startsWith("/pages/login/")) uni.setStorageSync("saidian-post-login-route", safeMallRoute(route));
  if (!loginRedirecting && !page?.route?.includes("pages/login/")) {
    loginRedirecting = true;
    uni.navigateTo({ url: "/pages/login/index", complete: () => { loginRedirecting = false; } });
  }
  return false;
}
export function money(cents?: number | null): string {
  return cents == null || !Number.isFinite(Number(cents)) ? "未获取" : `¥${(Number(cents) / 100).toFixed(2)}`;
}
export function toast(error: unknown): void {
  uni.showToast({
    title: error instanceof Error ? error.message : String(error),
    icon: "none",
    duration: 2500,
  });
}
export function goto(url: string): void {
  uni.navigateTo({ url });
}
