import QRCode from 'qrcode';
declare const wx: { env: { USER_DATA_PATH: string }; getFileSystemManager(): {
  writeFileSync(path: string, data: string, encoding: 'base64'): void;
  unlink(input: { filePath: string; fail(): void }): void;
} };

export function miniPosterEnvironment() { return typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function'; }
export function posterUtf8(text: string) {
  return new Uint8Array((encodeURIComponent(text).match(/%[0-9A-F]{2}|[^%]/g) || []).map(value => value.startsWith('%') ? parseInt(value.slice(1), 16) : value.charCodeAt(0)));
}
export function miniPosterSource(source: string) {
  if (!miniPosterEnvironment() || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(source)) return { path: source, release() {} };
  const path = wx.env.USER_DATA_PATH + '/mall-poster-' + Date.now() + '-' + Math.random().toString(36).slice(2) + (source.startsWith('data:image/jpeg;') ? '.jpg' : '.png');
  wx.getFileSystemManager().writeFileSync(path, source.split(',')[1]!, 'base64');
  return { path, release() { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } };
}

/** Uses the native canvas; no document, Image, URL or data-URL canvas renderer. */
export async function buildMiniPoster(canvasId: string, scope: unknown, input: {
  title: string; subtitle?: string; price?: string; image?: string; qrText?: string; qrDataUrl?: string; footer?: string;
}): Promise<string> {
  const context = uni.createCanvasContext(canvasId, scope);
  const temporary: ReturnType<typeof miniPosterSource>[] = [];
  const imagePath = async (source: string) => {
    const local = miniPosterSource(source); temporary.push(local);
    return new Promise<UniApp.GetImageInfoSuccessData>((resolve, reject) => uni.getImageInfo({ src: local.path, success: resolve, fail: reject }));
  };
  try {
    context.setFillStyle('#ffffff'); context.fillRect(0, 0, 750, 1080);
    context.setFillStyle('#d20b27'); context.setFontSize(36); context.fillText('SAYDIAN', 48, 70);
    context.setFillStyle('#111827'); context.setFontSize(36);
    const title = Array.from(input.title);
    context.fillText(title.slice(0, 18).join(''), 48, 138);
    if (title.length > 18) context.fillText(title.slice(18, 36).join(''), 48, 185);
    if (input.image) {
      try { const image = await imagePath(input.image); const scale = Math.min(654 / image.width, 470 / image.height);
        const width = image.width * scale, height = image.height * scale; context.drawImage(image.path, 48 + (654 - width) / 2, 230 + (470 - height) / 2, width, height);
      } catch { context.setFillStyle('#f3f5f8'); context.fillRect(48, 230, 654, 470); }
    }
    context.setFillStyle('#be092d'); context.setFontSize(46); context.fillText(input.price || '', 48, 770);
    context.setFillStyle('#4b5563'); context.setFontSize(25);
    context.fillText((input.subtitle || '分享给好友').slice(0, 22), 48, 830);
    if (input.qrText) {
      const matrix = QRCode.create([{ data: posterUtf8(input.qrText), mode: 'byte' }], { errorCorrectionLevel: 'M' }).modules;
      const moduleSize = 200 / (matrix.size + 8), left = 490 + moduleSize * 4, top = 810 + moduleSize * 4;
      context.setFillStyle('#ffffff'); context.fillRect(490, 810, 200, 200);
      context.setFillStyle('#111827');
      for (let row = 0; row < matrix.size; row++) for (let column = 0; column < matrix.size; column++) {
        if (matrix.get(row, column)) context.fillRect(left + column * moduleSize, top + row * moduleSize, moduleSize + 0.2, moduleSize + 0.2);
      }
    } else if (input.qrDataUrl) {
      const qr = await imagePath(input.qrDataUrl); context.drawImage(qr.path, 490, 810, 200, 200);
    }
    context.setFillStyle('#667085'); context.setFontSize(21); context.fillText((input.footer || '价格与库存以打开商城时为准').slice(0, 30), 48, 1040);
    await new Promise<void>(resolve => context.draw(false, resolve));
    return await new Promise<string>((resolve, reject) => uni.canvasToTempFilePath({ canvasId, width: 750, height: 1080,
      destWidth: 750, destHeight: 1080, fileType: 'png', success: result => resolve(result.tempFilePath), fail: () => reject(new Error('海报暂时无法生成')) }, scope));
  } finally { for (const item of temporary) item.release(); }
}
