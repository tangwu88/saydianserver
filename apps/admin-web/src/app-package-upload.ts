import axios from "axios";
import { api, responseData, adminSessionKey } from "./api";
export class PackageUploadError extends Error {}
type Progress = { stage: "hashing" | "uploading" | "retrying" | "verifying"; percent: number; attempt?: number };
type UploadResult = { fileName: string; url: string; sizeBytes: number; sha256: string };
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(new PackageUploadError("已取消上传")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
  if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
});
export async function uploadAppPackageChunks(file: File, platform: "android" | "harmonyos", product: string, progress: (value: Progress) => void, signal: AbortSignal): Promise<UploadResult> {
  const session = adminSessionKey();
  function current() {
    if (signal.aborted) throw new PackageUploadError("已取消上传");
    if (!session || adminSessionKey() !== session) throw new PackageUploadError("后台登录已变化，请重新登录后选择安装包");
  }
  current();
  if (!file.size || file.size > 128 * 1024 * 1024) throw new PackageUploadError("安装包大小必须在 128MB 以内");
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (header[0] !== 0x50 || header[1] !== 0x4b) throw new PackageUploadError("安装包格式不正确，请选择有效的 APK 或 HAP 文件");
  if (!globalThis.crypto?.subtle) throw new PackageUploadError("当前浏览器不支持文件校验，请使用新版浏览器打开 HTTPS 后台");
  progress({ stage: "hashing", percent: 0 });
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(n => n.toString(16).padStart(2, "0")).join("");
  current();
  const uploadId = crypto.randomUUID();
  let success = false, received = 0;
  async function retry<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      current();
      try { const value = await request(); current(); return value; }
      catch (error) {
        current();
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const temporary = axios.isAxiosError(error) && (!error.response || [409, 429, 500, 502, 503, 504].includes(status!));
        if (!temporary || attempt >= 3) {
          if (status === 401 || status === 403) throw new PackageUploadError("登录已失效或没有安装包上传权限，请重新登录后重试");
          if (status === 404) throw new PackageUploadError("上传会话已失效，请重新选择安装包");
          if (status === 413) throw new PackageUploadError("上传片段被服务器拒绝，请联系管理员检查上传限制");
          if (status === 429) throw new PackageUploadError("当前上传任务较多，请等待其他安装包完成后重试");
          if (status === 409) throw new PackageUploadError("服务器正在处理上传，请稍后重新选择安装包");
          if (status === 400) throw new PackageUploadError("安装包或分片校验失败，请重新选择正确的安装包");
          if (temporary) throw new PackageUploadError("上传连接多次中断，请检查网络后重新选择安装包；原下载版本未改变");
          throw error;
        }
        progress({ stage: "retrying", percent: Math.floor(received / file.size * 100), attempt: attempt + 1 });
        await sleep([500, 1500, 3500][attempt]!, signal);
      }
    }
  }
  try {
    const start = await retry(async () => responseData<{ uploadId: string; receivedBytes: number; chunkBytes: number }>(await api.post(`/app-packages/uploads?platform=${platform}&product=${encodeURIComponent(product)}`, { requestId: uploadId, fileName: file.name, sizeBytes: file.size, sha256 }, { signal, timeout: 60_000 })));
    if (start.uploadId !== uploadId || start.chunkBytes !== 1024 * 1024 || start.receivedBytes !== 0) throw new PackageUploadError("上传会话返回异常，请重新选择安装包");
    while (received < file.size) {
      progress({ stage: "uploading", percent: Math.floor(received / file.size * 100) });
      const offset = received, end = Math.min(offset + start.chunkBytes, file.size);
      const uploaded = await retry(async () => {
        const body = new FormData(); body.append("file", file.slice(offset, end), "package.part");
        return responseData<{ receivedBytes: number }>(await api.put(`/app-packages/uploads/${uploadId}/parts/${offset}`, body, { signal, timeout: 60_000 }));
      });
      if (uploaded.receivedBytes !== end) throw new PackageUploadError("上传片段确认异常，请重新选择安装包");
      received = end;
    }
    progress({ stage: "verifying", percent: 100 });
    const result = await retry(async () => responseData<UploadResult>(await api.post(`/app-packages/uploads/${uploadId}/complete`, {}, { signal, timeout: 300_000 })));
    const base = product === "saidian" ? "" : "/global";
    if (result.sha256 !== sha256 || result.sizeBytes !== file.size || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(apk|hap)$/.test(result.fileName) || !result.fileName.startsWith(`${product}-${platform}-`) || result.url !== `${base}/api/saydian-app/v2/support/app-package/${result.fileName}`) throw new PackageUploadError("上传结果校验失败，请重新选择安装包");
    success = true; return result;
  } finally {
    if (!success && adminSessionKey() === session) await api.delete(`/app-packages/uploads/${uploadId}`, { timeout: 10_000 }).catch(() => {});
  }
}
