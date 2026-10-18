// Public service details verified at https://www.saydian.cn/ on 2026-10-18.
export const officialSupport = {
  phone: '4006386738', phoneLabel: '400-638-6738', hours: '人工服务 8:00–18:00（北京时间）',
  wecomUrl: 'https://work.weixin.qq.com/kfid/kfcae32196355fde04c',
  home: 'https://www.saydian.cn/', support: 'https://www.saydian.cn/support/',
  ringSize: 'https://www.saydian.cn/guides/ring-size/', compare: 'https://www.saydian.cn/compare/',
  afterSale: 'https://www.saydian.cn/support/#after-sales', authenticity: 'https://www.saydian.cn/authenticity/',
};
export function openOfficial(url: string): void {
  if (!/^https:\/\/(?:www\.saydian\.cn|work\.weixin\.qq\.com)\//.test(url)) return;
  /* #ifdef H5 */
  location.assign(url);
  /* #endif */
  /* #ifndef H5 */
  uni.setClipboardData({ data: url });
  /* #endif */
}
