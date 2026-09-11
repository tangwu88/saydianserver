import { api, API_BASE, mallSessionStamp } from './api';
import { mallStorage, isGlobalMall } from './realm';

export const IMAGE_LIMITS = { maxFiles: 9, maxBytes: 10 * 1024 * 1024, contentTypes: ['image/jpeg', 'image/png', 'image/webp'] };
const root = '/storefront/after-sale-images';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type EvidenceFile = { path: string; size: number; type: string };
export function evidenceFile(value: any): EvidenceFile {
  const path = String(value?.path || value?.tempFilePath || '');
  const size = Number(value?.size ?? value?.file?.size);
  const name = String(value?.name || value?.file?.name || path).split('?')[0]!;
  const extension = name.match(/\.(jpe?g|png|webp)$/i)?.[1]?.toLowerCase();
  const type = String(value?.type || value?.file?.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string,string>)[extension || ''] || '');
  if (!path || !Number.isSafeInteger(size) || size <= 0 || size > IMAGE_LIMITS.maxBytes) throw new Error('请选择不超过 10MB 的图片');
  if (!IMAGE_LIMITS.contentTypes.includes(type)) throw new Error('仅支持 JPG、PNG 或 WebP 图片');
  return { path, size, type };
}
export function validEvidenceIds(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 9 && value.every(id => typeof id === 'string' && uuid.test(id)) && new Set(value).size === value.length; }

/** URLs are constructed here, never supplied by API responses or user input. */
function endpoint(suffix = '') {
  if (typeof window === 'undefined') throw new Error('请在浏览器中上传售后图片');
  const url = new URL(API_BASE + root + suffix, window.location.origin);
  if (url.origin !== window.location.origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('图片服务地址不安全，请联系管理员');
  return url.href;
}
export function createAfterSaleImageClient() {
  const stamp = mallSessionStamp(), userId = mallStorage.get('saidian-user')?.id;
  const token = String(mallStorage.get('saidian-token') || '');
  let cancelled = false;
  const aborts = new Set<() => void>(), urls = new Set<string>();
  const isCurrent = () => !cancelled && !!token && !!userId && stamp === mallSessionStamp() && userId === mallStorage.get('saidian-user')?.id && token === String(mallStorage.get('saidian-token') || '');
  const check = () => { if (!isCurrent()) throw new Error('账号或登录状态已变化，请重新打开售后页面'); if (isGlobalMall && mallStorage.get('saidian-user')?.phoneTestMode === true) throw new Error('请先使用已验证的手机号或邮箱登录'); };
  const cancel = () => { if (cancelled) return; cancelled = true; for (const abort of aborts) abort(); aborts.clear(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  const release = (url: string) => { if (urls.delete(url)) URL.revokeObjectURL(url); };
  return {
    isCurrent, cancel, release,
    async capabilities() { check(); try { const value: any = await api(root + '/capabilities', { auth: true, sessionStamp: stamp }); check(); return { ...IMAGE_LIMITS, enabled: value?.enabled === true, reason: value?.enabled === true ? '' : '暂时无法添加图片，您仍可提交文字说明。' }; } catch { check(); throw new Error('暂时无法添加图片，您仍可提交文字说明。'); } },
    async upload(file: EvidenceFile, progress: (value: number) => void) {
      check(); evidenceFile(file); const url = endpoint();
      return new Promise<{id:string;byteSize:number;contentType:string;sha256:string}>((resolve, reject) => {
        let settled = false; let task: UniApp.UploadTask | undefined;
        const finish = (error?: Error, value?: any) => { if (settled) return; settled = true; aborts.delete(abort); if (error) reject(error); else resolve(value); };
        const abort = () => { task?.abort(); finish(new Error('上传已取消，请重新选择图片')); };
        aborts.add(abort);
        try { task = uni.uploadFile({ url, filePath: file.path, name: 'file', header: { Authorization: 'Bearer ' + token },
          success(response) { try { check(); if (response.statusCode === 401) throw new Error('登录已失效，请重新登录后上传'); if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('图片上传失败，请重试'); const value = JSON.parse(response.data);
            if (!uuid.test(value?.id) || value.byteSize !== file.size || !IMAGE_LIMITS.contentTypes.includes(value.contentType) || !/^[0-9a-f]{64}$/i.test(value.sha256)) throw new Error('图片上传回执无效，请重试'); finish(undefined, value);
          } catch (error) { finish(error instanceof Error ? error : new Error('图片上传失败')); } },
          fail() { finish(new Error(isCurrent() ? '图片上传失败，请重试或移除' : '账号已切换，上传已取消')); },
        }); task.onProgressUpdate(value => { if (isCurrent() && !settled) progress(Math.max(0, Math.min(100, value.progress))); else if (!isCurrent()) abort(); }); }
        catch (error) { finish(error instanceof Error ? error : new Error('图片上传失败')); }
      });
    },
    async preview(id: string) {
      check(); if (!uuid.test(id)) throw new Error('图片编号无效');
      const controller = new AbortController(), abort = () => controller.abort(); aborts.add(abort);
      try { const response = await fetch(endpoint('/' + id), { headers: { Authorization: 'Bearer ' + token }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal }); check();
        if (response.status === 401) throw new Error('登录已失效，请重新登录查看图片');
        if (!response.ok) throw new Error('私有图片暂时无法读取');
        const type = (response.headers.get('content-type') || '').split(';')[0]!;
        if (!IMAGE_LIMITS.contentTypes.includes(type)) throw new Error('图片格式无效');
        const blob = await response.blob(); check(); if (blob.size <= 0 || blob.size > IMAGE_LIMITS.maxBytes) throw new Error('图片大小无效');
        const url = URL.createObjectURL(blob); urls.add(url); return url;
      } finally { aborts.delete(abort); }
    },
  };
}
