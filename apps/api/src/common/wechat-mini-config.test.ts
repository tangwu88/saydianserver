import { describe, it, expect, vi } from 'vitest';
import { wechatMiniConfiguration, assertWechatMiniPayment } from './wechat-mini-config';
const credentials = { appId: 'wxSyntheticMini001', appSecret: 'synthetic-secret-32-characters' };
function fixture(state = 'CONFIGURED', paymentEnabled = false) {
  const db = { integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state, publicConfig: { paymentEnabled } }) } };
  const secrets = { resolve: vi.fn().mockResolvedValue(credentials) };
  return { db, secrets };
}
describe('mini-program configuration isolation', () => {
  it('uses only the dedicated login credentials, independently of merchant readiness', async () => {
    const h = fixture(); expect(await wechatMiniConfiguration(h.db as any, h.secrets as any)).toMatchObject(credentials);
    expect(h.secrets.resolve).toHaveBeenCalledWith('wechat_mini', expect.objectContaining({ appId: 'WECHAT_MINI_APP_ID' }));
  });
  it.each(['UNCONFIGURED', 'DISABLED', 'ERROR'])('fails closed for %s without reading secrets', async state => {
    const h = fixture(state); await expect(wechatMiniConfiguration(h.db as any, h.secrets as any)).rejects.toMatchObject({ status: 503 }); expect(h.secrets.resolve).not.toHaveBeenCalled();
  });
  it('rejects incomplete identity and disabled or mismatched payments', async () => {
    const h = fixture(); await expect(assertWechatMiniPayment(h.db as any, h.secrets as any, credentials.appId)).rejects.toMatchObject({ status: 503 });
    h.db.integrationConfig.findUnique.mockResolvedValue({ state: 'CONFIGURED', publicConfig: { paymentEnabled: true } });
    await expect(assertWechatMiniPayment(h.db as any, h.secrets as any, 'wxDifferentMini001')).rejects.toMatchObject({ status: 503 });
    await expect(assertWechatMiniPayment(h.db as any, h.secrets as any, credentials.appId)).resolves.toBeUndefined();
    h.secrets.resolve.mockResolvedValue({ ...credentials, appSecret: '' });
    await expect(wechatMiniConfiguration(h.db as any, h.secrets as any)).rejects.toMatchObject({ status: 503 });
  });
});
