import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
const user = { id: 'member', status: 'ACTIVE', mobileVerifiedAt: new Date(), emailVerifiedAt: null, wechatOpenId: null, wechatUnionId: null };
const input = { code: 'synthetic-code', consentAccepted: true, consentVersion: 'synthetic-v1', consentSource: 'test' };
function fixture(current: any = user, owner: any = null, unionOwner: any = null) {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]), user: { findUnique: vi.fn(async ({ where }) => where.id ? current : where.wechatOpenId ? owner : unionOwner), update: vi.fn().mockResolvedValue(user) }, consentRecord: { upsert: vi.fn() } };
  const db = { $transaction: vi.fn(async fn => fn(tx)) };
  const auth = new AuthService(db as any, {} as any, {} as any, {} as any);
  const exchange = vi.spyOn(auth as any, 'exchangeWechatMini').mockResolvedValue({ openId: 'synthetic-openid', unionId: 'synthetic-unionid' });
  return { tx, auth, exchange };
}
afterEach(() => vi.restoreAllMocks());
describe('verified mini account binding', () => {
  it('locks and links only the current verified member without replacing their session or creating a user', async () => {
    const h = fixture(); await expect(h.auth.bindWechatMini('member', input)).resolves.toEqual({ bound: true });
    expect(h.tx.$queryRaw).toHaveBeenCalledOnce(); expect(h.tx.user.update).toHaveBeenCalledWith({ where: { id: 'member' }, data: { wechatOpenId: 'synthetic-openid', wechatUnionId: 'synthetic-unionid' } });
    expect(h.tx.consentRecord.upsert).toHaveBeenCalledTimes(2);
  });
  it.each([{ ...user, mobileVerifiedAt: null }, { ...user, status: 'DISABLED' }, null])('rejects unverified/inactive members before writes %j', async current => {
    const h = fixture(current); await expect(h.auth.bindWechatMini('member', input)).rejects.toMatchObject({ status: 401 }); expect(h.tx.user.update).not.toHaveBeenCalled(); expect(h.tx.consentRecord.upsert).not.toHaveBeenCalled();
  });
  it.each([{ owner: { id: 'another-member' } }, { unionOwner: { id: 'another-member' } }, { current: { ...user, wechatOpenId: 'other-openid' } }])('rejects conflicting accounts rather than merging them %j', async (options: { current?: any; owner?: any; unionOwner?: any }) => {
    const h = fixture(options.current ?? user, options.owner, options.unionOwner); await expect(h.auth.bindWechatMini('member', input)).rejects.toMatchObject({ status: 409 }); expect(h.tx.user.update).not.toHaveBeenCalled();
  });
});
