import { describe, it, expect, vi } from 'vitest';
import { validateWechatMiniSettings } from './wechat-mini-settings';
const credentials = { appId: 'wxSyntheticMini001', appSecret: 'synthetic-mini-app-secret' };
function fixture(state = 'UNCONFIGURED', users = 0, saved: Record<string, unknown> = {}) {
  const db = { integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state }) }, user: { count: vi.fn().mockResolvedValue(users) } };
  const secrets = { read: vi.fn(async (key: string) => key === 'wechat_mini' ? saved : {}) };
  return { db, secrets };
}
describe('mini settings validation before writes', () => {
  it('accepts a complete first configuration without any provider call', async () => {
    const h = fixture(); await expect(validateWechatMiniSettings(h.db as any, h.secrets as any, { secrets: credentials, publicConfig: { paymentEnabled: false, requestDomains: ['app.saydian.cn'] } }, 'CONFIGURED')).resolves.toBeUndefined();
  });
  it('requires pausing before credential replacement even if the new payload disables the service', async () => {
    const h = fixture('CONFIGURED'); await expect(validateWechatMiniSettings(h.db as any, h.secrets as any, { secrets: credentials }, 'DISABLED')).rejects.toMatchObject({ status: 409 }); expect(h.secrets.read).not.toHaveBeenCalled();
  });
  it('cannot enable payments with a different merchant AppID', async () => {
    const h = fixture('DISABLED', 0, credentials);
    Object.assign(h.secrets, { resolve: vi.fn().mockResolvedValue({ appIdMini: 'wxAnotherMerchant01' }) });
    await expect(validateWechatMiniSettings(h.db as any, h.secrets as any, { publicConfig: { paymentEnabled: true } }, 'CONFIGURED')).rejects.toMatchObject({ status: 400 });
  });
  it.each([{ appSecret: 'leak' }, { requestDomains: ['https://app.saydian.cn/path'] }, { paymentEnabled: 'true' }])('rejects unsafe public configuration %j', async publicConfig => {
    const h = fixture(); await expect(validateWechatMiniSettings(h.db as any, h.secrets as any, { publicConfig }, 'UNCONFIGURED')).rejects.toMatchObject({ status: 400 });
  });
  it('refuses to enable incomplete secrets or rotate an AppID with existing unscoped mini identities', async () => {
    const h = fixture('DISABLED', 1, credentials);
    await expect(validateWechatMiniSettings(h.db as any, h.secrets as any, { secrets: { appId: 'wxDifferentMini001', appSecret: credentials.appSecret } }, 'CONFIGURED')).rejects.toMatchObject({ status: 409 });
    await expect(validateWechatMiniSettings(h.db as any, h.secrets as any, { secrets: { appId: credentials.appId } }, 'CONFIGURED')).rejects.toMatchObject({ status: 400 });
    await expect(validateWechatMiniSettings(h.db as any, h.secrets as any, { secrets: credentials }, 'CONFIGURED')).resolves.toBeUndefined();
  });
});
