import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationSecretsService, encryptIntegrationSecrets, decryptIntegrationSecrets } from '../common/integration-secrets.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PATH_METADATA } from '@nestjs/common/constants';
const appId='wxSyntheticMini001', key=Buffer.alloc(32,7);
const original={appIdOfficial:'wxSyntheticH5App001',merchantId:'synthetic-merchant',privateKeyPem:'synthetic-private-key',apiV3Key:'synthetic-api-key',platformPublicKeyPem:'synthetic-public-key',serialNo:'synthetic-serial',customFutureField:'preserve'};
function fixture(stored:Record<string,unknown>|null=original){
 vi.stubEnv('INTEGRATION_MASTER_KEY',key.toString('hex'));
 vi.stubEnv('WECHAT_PAY_APP_ID_MINI','');
 let row:any=stored?{integrationKey:'wechat_pay',...encryptIntegrationSecrets('wechat_pay',stored,key)}:null;
 const table={findUnique:vi.fn(async()=>row),updateMany:vi.fn(async({where,data}:any)=>{
  if(where.ciphertext!==row?.ciphertext)return{count:0};row={...row,...data};return{count:1};
 }),create:vi.fn(async({data}:any)=>{row=data;return row})};
 const service=new IntegrationSecretsService({integrationSecret:table} as any);
 return{service,table,read:()=>decryptIntegrationSecrets('wechat_pay',row,key)};
}
afterEach(()=>vi.unstubAllEnvs());
describe('supplementing mini AppID preserves existing merchant configuration',()=>{
 it('changes only AppID and never returns existing credentials',async()=>{
  const h=fixture();expect(await h.service.supplementWechatPayMiniAppId(appId)).toBeUndefined();
  expect(h.read()).toEqual({...original,appIdMini:appId});
  expect(h.table.updateMany.mock.calls[0]![0].where).toMatchObject({integrationKey:'wechat_pay'});
 });
 it('does not silently replace a previous mini AppID',async()=>{
  const h=fixture({...original,appIdMini:'wxPreviousMini001'});
  await expect(h.service.supplementWechatPayMiniAppId(appId)).rejects.toMatchObject({status:409});
  expect(h.table.updateMany).not.toHaveBeenCalled();
 });
 it('same AppID is idempotent and keeps the encrypted row untouched',async()=>{
  const h=fixture({...original,appIdMini:appId});await h.service.supplementWechatPayMiniAppId(appId);
  expect(h.table.updateMany).not.toHaveBeenCalled();
 });
 it('keeps all environment-based merchant fallbacks intact',async()=>{
  const h=fixture(null);vi.stubEnv('WECHAT_PAY_MERCHANT_ID','synthetic-env-merchant');
  await h.service.supplementWechatPayMiniAppId(appId);
  expect(h.read()).toEqual({appIdMini:appId});
  expect(await h.service.resolve('wechat_pay',{merchantId:'WECHAT_PAY_MERCHANT_ID',appIdMini:'WECHAT_PAY_APP_ID_MINI'})).toEqual({merchantId:'synthetic-env-merchant',appIdMini:appId});
 });
 it('rejects a concurrent credential change rather than overwriting it',async()=>{
  const h=fixture();h.table.updateMany.mockResolvedValueOnce({count:0});
  await expect(h.service.supplementWechatPayMiniAppId(appId)).rejects.toMatchObject({status:409});
  expect(h.read()).toEqual(original);
 });
 it('does not overwrite an existing AppID from server configuration',async()=>{
  const h=fixture(null);vi.stubEnv('WECHAT_PAY_APP_ID_MINI','wxDifferentEnv001');
  await expect(h.service.supplementWechatPayMiniAppId(appId)).rejects.toMatchObject({status:409});
  expect(h.table.create).not.toHaveBeenCalled();
 });
});
describe('admin supplement request is isolated from state and public payment parameters',()=>{
 it('uses an independent path that old generic integration saves cannot match',()=>{
  expect(Reflect.getMetadata(PATH_METADATA, AdminController.prototype.supplementWechatPayMiniAppId)).toBe('integrations/wechat_pay/mini-app-id');
  expect(Reflect.getMetadata(PATH_METADATA, AdminController.prototype.updateIntegration)).toBe('integrations/:key');
 });
 function admin(state='CONFIGURED',loginAppId=appId){
  const db={integrationConfig:{findUnique:vi.fn(async()=>({state})),upsert:vi.fn(),update:vi.fn()}};
  const secrets={resolve:vi.fn(async()=>({appId:loginAppId})),supplementWechatPayMiniAppId:vi.fn(async()=>{})};
  return{db,secrets,service:new AdminService(db as any,secrets as any)};
 }
 it('preserves H5 enablement, callback and all public fields',async()=>{
  const h=admin();expect(await h.service.updateIntegration('wechat_pay',{miniPaymentAppId:appId})).toEqual({key:'wechat_pay',miniPaymentAppIdSaved:true});
  expect(h.secrets.supplementWechatPayMiniAppId).toHaveBeenCalledWith(appId);
  expect(h.db.integrationConfig.upsert).not.toHaveBeenCalled();expect(h.db.integrationConfig.update).not.toHaveBeenCalled();
 });
 it.each([{miniPaymentAppId:appId,state:'DISABLED'},{miniPaymentAppId:appId,secrets:{}},{miniPaymentAppId:appId,clearSecrets:true},{miniPaymentAppId:appId,publicConfig:{}}])('rejects combined edits %j',async input=>{
  const h=admin();await expect(h.service.updateIntegration('wechat_pay',input)).rejects.toMatchObject({status:400});
  expect(h.secrets.supplementWechatPayMiniAppId).not.toHaveBeenCalled();
 });
 it('requires configured original payment and matching login AppID',async()=>{
  for(const h of [admin('DISABLED'),admin('CONFIGURED','wxOtherLogin001')]){
   await expect(h.service.updateIntegration('wechat_pay',{miniPaymentAppId:appId})).rejects.toMatchObject({status:400});
   expect(h.secrets.supplementWechatPayMiniAppId).not.toHaveBeenCalled();
  }
 });
});
