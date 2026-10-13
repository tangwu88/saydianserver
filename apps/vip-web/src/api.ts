import axios from "axios";
export const partnerTokenKey = "saydian-brand-partner-token";
export const api = axios.create({
  baseURL: "/api/saydian-app/vip/v1",
  timeout: 25_000,
});
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(partnerTokenKey);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      sessionStorage.removeItem(partnerTokenKey);
      if (!location.pathname.endsWith("/login"))
        location.assign(`${import.meta.env.BASE_URL}login`);
    }
    return Promise.reject(error);
  },
);
export function data<T = any>(response: { data: unknown }): T {
  return (response.data as { data: T }).data;
}
export function errorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) return "操作未完成，请稍后重试";
  const message = (error.response?.data as { message?: unknown })?.message;
  return typeof message === "string" ? message : "网络不可用，请检查后重试";
}
export function requestKey() {
  return crypto.randomUUID();
}
