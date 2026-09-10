import { globalLegalPath } from "./global-auth-model";
export type GlobalLegalDocument = { version: string; locale: string; title: string; contentHtml: string };
export async function loadGlobalLegal(reference: any): Promise<GlobalLegalDocument> {
  const url = globalLegalPath(reference?.path);
  return new Promise((resolve, reject) => uni.request({
    url, method: "GET", timeout: 15000,
    success(response) {
      const envelope = response.data as any;
      const document = envelope?.data;
      if (response.statusCode !== 200 || envelope?.code !== 200 || !document?.contentHtml || document.version !== reference.version || document.locale !== reference.locale) {
        reject(new Error("国际版协议未发布、版本不一致或读取失败，请重试")); return;
      }
      resolve(document);
    }, fail: () => reject(new Error("协议读取失败，请检查网络后重试")),
  }));
}
export function legalPlainText(html: string) {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html.replace(/<\/(p|div|h[1-6]|li|section)>/gi, "$&\n").replace(/<br\s*\/?\s*>/gi, "\n"), "text/html");
    document.querySelectorAll("script,style,iframe,object").forEach(node => node.remove());
    return document.body.textContent || "";
  }
  return html.replace(/<[^>]+>/g, " ");
}
