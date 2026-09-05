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
    uni.setStorageSync("saidian-token", response.token);
    uni.setStorageSync("saidian-refresh-token", response.refreshToken);
    uni.setStorageSync("saidian-user", response.user);
    return response.user;
  })();
  miniLoginPromise = login;
  try {
    return await login;
  } finally {
    if (miniLoginPromise === login) miniLoginPromise = null;
  }
}
export const productPlaceholder = "https://www.saydian.cn/pic/1.png";
export async function api<T = any>(
  path: string,
  options: {
    method?: UniApp.RequestOptions["method"];
    data?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  let token = String(uni.getStorageSync("saidian-token") || "");
  if (options.auth && !token && isWeixinMiniProgram()) {
    await ensureMiniProgramSession();
    token = String(uni.getStorageSync("saidian-token") || "");
  }
  return request<T>(path, options, token, true);
}

function request<T>(
  path: string,
  options: {
    method?: UniApp.RequestOptions["method"];
    data?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
  },
  token: string,
  allowRefresh: boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestOptions: UniApp.RequestOptions = {
      url: `${API_BASE}${path}`,
      method: options.method ?? "GET",
      header: {
        "content-type": "application/json",
        ...(options.auth && token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      async success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300)
          resolve(response.data as T);
        else {
          const message = (response.data as any)?.message ?? "请求失败";
          if (response.statusCode === 401 && options.auth && allowRefresh) {
            try {
              const session = await refreshMallSession();
              resolve(await request<T>(path, options, session.token, false));
              return;
            } catch {
              clearMallSession();
              uni.navigateTo({ url: "/pages/login/index" });
            }
          }
          reject(
            new Error(Array.isArray(message) ? message.join("；") : message),
          );
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

async function refreshMallSession(): Promise<any> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = String(
    uni.getStorageSync("saidian-refresh-token") || "",
  );
  if (!refreshToken) throw new Error("登录已失效");
  const pending = new Promise<any>((resolve, reject) =>
    uni.request({
      url: `${API_BASE}/auth/refresh`,
      method: "POST",
      data: { refreshToken },
      header: { "content-type": "application/json" },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const session = response.data as any;
          uni.setStorageSync("saidian-token", session.token);
          uni.setStorageSync("saidian-refresh-token", session.refreshToken);
          uni.setStorageSync("saidian-user", session.user);
          resolve(session);
          return;
        }
        reject(new Error("登录已失效"));
      },
      fail: reject,
    }),
  );
  refreshPromise = pending;
  try {
    return await pending;
  } finally {
    if (refreshPromise === pending) refreshPromise = null;
  }
}

export function clearMallSession(): void {
  uni.removeStorageSync("saidian-token");
  uni.removeStorageSync("saidian-refresh-token");
  uni.removeStorageSync("saidian-user");
}
export function money(cents?: number | null): string {
  return `¥${((cents ?? 0) / 100).toFixed(2)}`;
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
