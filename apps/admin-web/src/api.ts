import axios from "axios";

const tokenKey = "saydian-admin-token";

export const api = axios.create({
  baseURL: "/api/saydian-app/admin/v1",
  timeout: 20_000,
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(tokenKey);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      sessionStorage.removeItem(tokenKey);
      if (!location.pathname.endsWith("/login")) {
        location.assign(`${import.meta.env.BASE_URL}login`);
      }
    }
    return Promise.reject(error);
  },
);

export function setAdminToken(token: string): void {
  sessionStorage.setItem(tokenKey, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(tokenKey);
}

export function hasAdminToken(): boolean {
  return Boolean(sessionStorage.getItem(tokenKey));
}

export function responseData<T>(response: { data: unknown }): T {
  const envelope = response.data as { data?: T };
  return envelope.data as T;
}

export function readableError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "请求失败，请稍后重试";
  const payload = error.response?.data as { message?: string } | undefined;
  return payload?.message || "网络不可用，请检查后重试";
}
