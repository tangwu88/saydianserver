import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export function wechatMiniExchangeError(providerCode: unknown) {
  const parsed = Number(providerCode);
  const code = Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : null;
  if (code === 40029 || code === 40163) {
    return new UnauthorizedException({ errorKey: 'wechat_mini_code_invalid', message: `微信登录凭证无效或已使用（${code}），请重新点击微信登录；仍失败时请核对开发工具与后台 AppID。` });
  }
  return new ServiceUnavailableException({ errorKey: 'wechat_mini_exchange_failed', message: code === null
    ? '微信登录服务暂不可用，请稍后重试。'
    : `微信登录服务验证失败（${code}），请联系管理员核对小程序配置。` });
}
