import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { safeObject } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { IntegrationSecretsService } from '../common/integration-secrets.service';
import { wechatMiniConfiguration } from '../common/wechat-mini-config';

@Injectable()
export class MiniShareService {
  private token: { key: string; value: string; expires: number } | undefined;
  private readonly cache = new Map<string, { expires: number; value: { codeDataUrl: string } | { urlLink: string } }>();
  constructor(private readonly prisma: PrismaService, private readonly secrets: IntegrationSecretsService) {}

  async create(raw: unknown) {
    const body = safeObject(raw);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(body).some(key => !['page', 'productId', 'referral', 'envVersion', 'kind'].includes(key))
      || typeof body.page !== 'string' || !['home', 'product'].includes(body.page)
      || typeof body.kind !== 'string' || !['code', 'link'].includes(body.kind)
      || (body.envVersion !== undefined && (typeof body.envVersion !== 'string' || !['release', 'trial', 'develop'].includes(body.envVersion)))
      || (body.productId !== undefined && (typeof body.productId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.productId)))
      || (body.referral !== undefined && (typeof body.referral !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.referral)))) {
      throw new BadRequestException('小程序分享参数不正确');
    }
    const input = { page: String(body.page), kind: String(body.kind), productId: body.productId as string | undefined,
      referral: body.referral as string | undefined, envVersion: String(body.envVersion ?? 'release') };
    if (input.page === 'product') {
      if (!input.productId) throw new BadRequestException('缺少商品编号');
      const product = await this.prisma.commerceProduct.findFirst({ where: { id: input.productId, status: 'PUBLISHED', localArchived: false }, select: { id: true } });
      if (!product) throw new NotFoundException('商品已下架或不存在');
    }
    const { appId, appSecret } = await wechatMiniConfiguration(this.prisma, this.secrets);
    const key = createHash('sha256').update(appId + ':' + appSecret).digest('hex');
    const page = input.page === 'product' ? 'pages/product/index' : 'pages/home/index';
    const query = [input.page === 'product' ? 'id=' + input.productId : '', input.referral ? 'ref=' + input.referral : ''].filter(Boolean).join('&');
    const path = page + (query ? '?' + query : '');
    if (Buffer.byteLength(path) > 128) throw new BadRequestException('分享路径过长');
    const cacheKey = [key, input.kind, input.envVersion, path].join(':');
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    try {
      if (!this.token || this.token.key !== key || this.token.expires <= Date.now()) {
        const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
          body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: false }),
        });
        const data = await response.json() as Record<string, unknown>;
        if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || Number(data.errcode ?? 0) !== 0) throw new Error('token');
        this.token = { key, value: data.access_token, expires: Date.now() + Math.max(0, Math.min(7200, Number(data.expires_in) || 0) - 120) * 1000 };
      }
      const endpoint = input.kind === 'code' ? 'getwxacode' : 'generate_urllink';
      const response = await fetch(`https://api.weixin.qq.com/wxa/${endpoint}?access_token=${encodeURIComponent(this.token.value)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify(input.kind === 'code'
          ? { path, env_version: input.envVersion, width: 430 }
          : { path: page, query, env_version: input.envVersion, is_expire: true, expire_type: 0, expire_time: Math.floor(Date.now() / 1000) + 86400 }),
      });
      if (!response.ok) throw new Error('provider');
      let value: { codeDataUrl: string } | { urlLink: string };
      if (input.kind === 'code') {
        const bytes = Buffer.from(await response.arrayBuffer());
        const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255,216,255]));
        if (bytes.length > 1048576 || (!png && !jpeg)) throw new Error('code');
        value = { codeDataUrl: 'data:image/' + (png ? 'png' : 'jpeg') + ';base64,' + bytes.toString('base64') };
      } else {
        const data = await response.json() as Record<string, unknown>;
        if (Number(data.errcode ?? 0) !== 0 || typeof data.url_link !== 'string') throw new Error('link');
        const url = new URL(data.url_link);
        if (url.protocol !== 'https:' || !['wxaurl.cn', 'wxmpurl.cn', 'mp.weixin.qq.com'].includes(url.hostname)) throw new Error('link');
        value = { urlLink: url.toString() };
      }
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, { expires: Date.now() + 600000, value });
      return value;
    } catch {
      this.token = undefined;
      throw new ServiceUnavailableException('小程序分享暂不可用，请稍后重试；体验版页面需先上传到微信公众平台');
    }
  }
}
