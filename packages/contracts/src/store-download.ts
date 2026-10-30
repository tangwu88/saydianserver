export const STORE_DOWNLOAD_KEY = "store.appDownload";
export const defaultStoreDownload = {
  title: "赛电官方 APP",
  description: "设备连接 · 健康数据查看",
  iconUrl: "",
  cnUrl: "https://app.saydian.cn/down",
  ringUrl: "https://app.saydian.cn/down2",
  internationalUrl: "https://us.saydian.com/down/",
};
export type StoreDownloadConfig = typeof defaultStoreDownload;

/** This public configuration contains presentation only, never release/package metadata. */
export function parseStoreDownload(value: unknown): StoreDownloadConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("下载入口配置格式不正确");
  const input = value as Record<string, unknown>;
  const result = { ...defaultStoreDownload };
  for (const key of Object.keys(result) as (keyof StoreDownloadConfig)[]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "string") throw new Error("下载入口字段必须为文本");
    result[key] = (input[key] as string).trim();
  }
  if (!result.title || result.title.length > 24 || !result.description || result.description.length > 48) throw new Error("标题限24字，说明限48字，均不能为空");
  const paths = { cnUrl: ["/down", "/down/cn", "/global/down"], ringUrl: ["/down2", "/say-ring"], internationalUrl: ["/down"] };
  for (const key of ["cnUrl", "ringUrl", "internationalUrl"] as const) {
    let url: URL;
    try { url = new URL(result[key]); } catch { throw new Error("请填写官方 HTTPS 下载页地址"); }
    const host = key === "internationalUrl" ? "us.saydian.com" : "app.saydian.cn";
    if (url.protocol !== "https:" || url.host !== host || url.username || url.password || url.search || url.hash || !paths[key].includes(url.pathname.replace(/\/$/, ""))) throw new Error("下载地址必须指向对应 APP 的官方入口");
  }
  if (result.iconUrl) {
    let url: URL;
    try { url = new URL(result.iconUrl); } catch { throw new Error("图标请填写本站 HTTPS 图片地址"); }
    if (url.protocol !== "https:" || !["app.saydian.cn", "www.saydian.cn"].includes(url.host) || url.username || url.password || result.iconUrl.length > 1024) throw new Error("图标请填写本站 HTTPS 图片地址");
  }
  return result;
}
