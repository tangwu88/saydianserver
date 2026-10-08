import { api } from './api';
import { mallStorage } from './realm';
declare const wx: { getAccountInfoSync(): { miniProgram: { envVersion: 'release' | 'trial' | 'develop' } } };
export function miniShareReferral() {
  const value = String(mallStorage.get('saidian-ref') || '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : '';
}
export function miniSharePath(productId?: string) {
  const ref = miniShareReferral();
  return (productId ? '/pages/product/index?id=' + encodeURIComponent(productId) : '/pages/home/index')
    + (ref ? (productId ? '&' : '?') + 'ref=' + encodeURIComponent(ref) : '');
}
export async function miniShareAsset(kind: 'code' | 'link', productId?: string) {
  let envVersion: 'release' | 'trial' | 'develop' = 'release';
  try { envVersion = wx.getAccountInfoSync().miniProgram.envVersion; } catch {}
  const referral = miniShareReferral();
  return api<{ codeDataUrl?: string; urlLink?: string }>('/storefront/mini-share', {
    method: 'POST', data: { kind, page: productId ? 'product' : 'home', envVersion,
      ...(productId ? { productId } : {}), ...(referral ? { referral } : {}) },
  });
}
export async function copyMiniShareLink(productId?: string) {
  const result = await miniShareAsset('link', productId);
  if (!result.urlLink) throw new Error('小程序链接暂不可用');
  uni.setClipboardData({ data: result.urlLink, success: () => uni.showToast({ title: '小程序链接已复制', icon: 'none' }) });
}
