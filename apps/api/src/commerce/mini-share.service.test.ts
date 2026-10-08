import { afterEach, expect, it, vi } from 'vitest';
import { MiniShareService } from './mini-share.service';
const id = '11111111-1111-4111-8111-111111111111';
const png = Buffer.from([137,80,78,71,13,10,26,10]);
function setup() {
  const prisma: any = { integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: 'CONFIGURED', publicConfig: {} }) }, commerceProduct: { findFirst: vi.fn().mockResolvedValue({ id }) } };
  const secrets: any = { resolve: vi.fn().mockResolvedValue({ appId: 'wx1234567890abcdef', appSecret: 'synthetic-secret-never-return' }) };
  const request = vi.fn();vi.stubGlobal('fetch', request);
  return { service: new MiniShareService(prisma, secrets), request, prisma };
}
afterEach(() => vi.unstubAllGlobals());
it('creates a mini-program product code with referral and trial environment, and caches it', async () => {
  const h = setup();
  h.request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'synthetic-token', expires_in: 7200 }))).mockResolvedValueOnce(new Response(png));
  const input = { page: 'product', productId: id, referral: 'ref_42', envVersion: 'trial', kind: 'code' };
  const result = await h.service.create(input);
  expect(result).toEqual({ codeDataUrl: 'data:image/png;base64,' + png.toString('base64') });
  expect(JSON.parse(h.request.mock.calls[1]![1].body)).toEqual({ path: 'pages/product/index?id=' + id + '&ref=ref_42', env_version: 'trial', width: 430 });
  expect(await h.service.create(input)).toEqual(result);
  expect(h.request).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain('synthetic-token');
});
it('returns a WeChat mini-program home URL Link rather than an H5 URL', async () => {
  const h = setup();
  h.request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'synthetic-token', expires_in: 7200 }))).mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, url_link: 'https://wxaurl.cn/synthetic' })));
  expect(await h.service.create({ page: 'home', kind: 'link', envVersion: 'release' })).toEqual({ urlLink: 'https://wxaurl.cn/synthetic' });
  expect(JSON.parse(h.request.mock.calls[1]![1].body)).toMatchObject({ path: 'pages/home/index', query: '', env_version: 'release', is_expire: true });
});
it('rejects arbitrary paths, invalid referral and unavailable products before calling WeChat', async () => {
  const h = setup();
  await expect(h.service.create({ page: 'home', kind: 'link', path: 'pages/admin/index' })).rejects.toThrow();
  await expect(h.service.create({ page: 'home', kind: 'code', referral: 'bad&ref' })).rejects.toThrow();
  h.prisma.commerceProduct.findFirst.mockResolvedValue(null);
  await expect(h.service.create({ page: 'product', productId: id, kind: 'code' })).rejects.toThrow('商品已下架');
  expect(h.request).not.toHaveBeenCalled();
});
it('does not turn provider errors into a webpage QR or leak provider secrets', async () => {
  const h = setup();
  h.request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'synthetic-token', expires_in: 7200 }))).mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 41030, errmsg: 'synthetic-secret-never-return' })));
  await expect(h.service.create({ page: 'home', kind: 'code' })).rejects.toThrow('小程序分享暂不可用');
});
it('supports JPEG mini-program codes', async () => {
  const h = setup();const image = Buffer.from([255,216,255,224]);
  h.request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'synthetic-token', expires_in: 7200 }))).mockResolvedValueOnce(new Response(image));
  expect(await h.service.create({ page: 'home', kind: 'code' })).toEqual({ codeDataUrl: 'data:image/jpeg;base64,' + image.toString('base64') });
});
