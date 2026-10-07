import { describe, it, expect } from 'vitest';
import { SafeHttpExceptionFilter } from '../common/http-exception.filter';
import { wechatMiniExchangeError } from './wechat-mini-error';
describe('mini-program exchange errors remain useful through the HTTP filter', () => {
  it.each([40029, 40163, 40013, 40125, 40164])('returns only a safe numeric provider code for %s', code => {
    const exception=wechatMiniExchangeError(code);
    let result:any;
    const response:any={status:()=>response,json:(value:any)=>{result=value}};
    new SafeHttpExceptionFilter().catch(exception,{switchToHttp:()=>({getRequest:()=>({originalUrl:'/api/saidian-mall/v1/auth/wechat/mini'}),getResponse:()=>response})} as any);
    expect(result.message).toContain(String(code));
    expect(result.message).not.toBe('Please sign in again.');
    expect(result.errorKey).toMatch(/^wechat_mini_/);
    expect(result.code).toBe([40029,40163].includes(code)?401:503);
  });
  it('does not echo malformed provider content or internal identifiers',()=>{
    expect(JSON.stringify(wechatMiniExchangeError('synthetic-secret-or-url').getResponse())).not.toContain('synthetic-secret-or-url');
    expect(wechatMiniExchangeError(undefined).getStatus()).toBe(503);
  });
});
