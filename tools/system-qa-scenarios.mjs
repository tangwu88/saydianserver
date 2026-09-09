// Persistent synthetic scenarios, only for the dedicated loopback H5 demo.
// Accounts are registered through real HTTP. Fixture assets are never real funds.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { validateDemoProfile } from './h5-demo-profile.mjs';

assert.equal(process.env.RUN_SYSTEM_QA, '1', 'Explicit isolated QA opt-in required');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..'), profilePath = process.argv[2];
const profile = parseEnv(await readFile(profilePath, 'utf8'));
validateDemoProfile(profile, repo, profilePath);
const privatePath = join(dirname(profilePath), 'system-qa-accounts.json');
const scope = 'SYSTEM-QA-20260909';
let previous;
try { previous = JSON.parse(await readFile(privatePath, 'utf8')); assert.equal(previous.scope, scope); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const password = previous?.password || process.env.SYSTEM_QA_TEST_PASSWORD;
assert.ok(password?.length >= 20, 'Supply a new synthetic-only password; never use a real credential');
for (const key of Object.keys(process.env)) if (/^(WECHAT|WECOM|ALIPAY|SMS_|JUSHUITAN|OBJECT_STORAGE|APPLE_|PUSH_|AI_)/.test(key)) delete process.env[key];
Object.assign(process.env, profile, { TS_NODE_PROJECT: join(repo, 'apps/api/tsconfig.json'),
  // In this isolated process only; no actual Worker is started.
  WORKER_OUTBOUND_PAUSED: 'false', CALLBACK_PROCESSING_PAUSED: 'false' });
const require = createRequire(join(repo, 'apps/api/package.json'));
require(join(repo, 'tools/h5-demo-network-guard.cjs'));
const { PrismaClient } = require('@prisma/client'), { sign } = require('jsonwebtoken');
const prisma = new PrismaClient();
const fixtureId = key => { const x=createHash('sha256').update(scope+':'+key).digest('hex'); return `${x.slice(0,8)}-${x.slice(8,12)}-4${x.slice(13,16)}-a${x.slice(17,20)}-${x.slice(20,32)}`; };
const result = previous || { scope, password, admins: [], members: [], employee: {}, orders: [] };
let requests = 0, assertions = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
async function save() { await writeFile(privatePath, JSON.stringify(result, null, 2), { mode: 0o600 }); }
async function call(path, { method='GET', token, body, expected=200, key }={}) {
  assert.ok(path.startsWith('/api/'));
  const response=await fetch('http://127.0.0.1:8081'+path, {method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{
    ...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  requests++; const raw=await response.json();
  // Never include raw response (could contain a token) in failure logs.
  if (!(Array.isArray(expected)?expected:[expected]).includes(response.status)) throw new Error(`${method} ${path} expected ${expected}, received ${response.status}`);
  return raw?.data ?? raw;
}
const mall='/api/saidian-mall/v1', admin='/api/saydian-app/admin/v1', app='/api/saydian-app/v2';
try {
  check(await prisma.integrationSecret.count(),0,'No provider secrets');
  check(await prisma.integrationConfig.count({where:{state:'CONFIGURED'}}),0,'Providers remain unconfigured');
  check((await call(mall+'/storefront/capabilities')).demo,true,'Dedicated demo API');
  await save(); // Keep the synthetic password before any account can be created.
  const adminSession=await call(admin+'/auth/login',{method:'POST',body:{username:profile.H5_DEMO_ADMIN_USERNAME,password:profile.H5_DEMO_ADMIN_PASSWORD},expected:[200,201]});
  const roles=['SUPER_ADMIN','APP_OPERATIONS','COMMERCE_OPERATIONS','FINANCE','CONTENT_EDITOR','CUSTOMER_SERVICE','HEALTH_AUDITOR','INTEGRATION_ADMIN','API_DOC_EDITOR','READ_ONLY'];
  for(const role of roles){
    const username='system-qa-'+role.toLowerCase();
    let row=await prisma.adminUser.findUnique({where:{username}});
    if(row)check(row.displayName,scope+' '+role,'Existing admin ownership');
    else row=await call(admin+'/admin-users',{method:'POST',token:adminSession.token,body:{username,password,displayName:scope+' '+role,roles:[role]},expected:[200,201]});
    const login=await call(admin+'/auth/login',{method:'POST',body:{username,password},expected:[200,201]});
    check(login.user.roles,[role],'Single role assignment');
    result.admins=result.admins.filter(x=>x.role!==role);result.admins.push({role,username,id:row.id});await save();
    await call(admin+'/auth/logout',{method:'POST',token:login.token,expected:[200,201]});
  }
  for(let i=1;i<=3;i++){
    const mobile='1990000910'+i, nickname=scope+' 会员'+i;
    let row=await prisma.user.findUnique({where:{mobile}});
    if(row)check(row.nickname,nickname,'Existing member ownership');
    else {
      const otp=await call(app+'/auth/sms-code',{method:'POST',body:{mobile,usage:'register'},expected:[200,201]});
      check(otp.devCode,'123456','Development OTP only');
      await call(app+'/auth/register-with-sms',{method:'POST',body:{mobile,code:otp.devCode,password,nickname,consentVersion:'system-qa-local-nonbinding'},expected:[200,201]});
      row=await prisma.user.findUniqueOrThrow({where:{mobile}});
    }
    assert.ok(row.mobileVerifiedAt,'Registration verified phone');assertions++;
    const login=await call(mall+'/auth/password/login',{method:'POST',body:{mobile,password},expected:[200,201]});
    check(login.user.id,row.id,'Unified password member identity');
    const addresses=await call(mall+'/storefront/addresses',{token:login.token});
    let address=addresses.find(x=>x.name===scope);
    if(!address) address=await call(mall+'/storefront/addresses',{method:'POST',token:login.token,body:{name:scope,mobile,province:'模拟省',city:'模拟市',district:'模拟区',detail:'本地合成地址，禁止真实发货',isDefault:true},expected:[200,201]});
    result.members=result.members.filter(x=>x.mobile!==mobile);result.members.push({id:row.id,mobile,nickname,addressId:address.id});await save();
    await prisma.$transaction(async tx=>{
      const key=scope+':points:'+row.id;
      if(!await tx.commercePointLedger.findUnique({where:{idempotencyKey:key}})){
        await tx.commercePointAccount.upsert({where:{userId:row.id},create:{userId:row.id,balanceCents:10000},update:{balanceCents:{increment:10000},version:{increment:1}}});
        await tx.commercePointLedger.create({data:{userId:row.id,type:'DEMO_TEST_CREDIT',deltaCents:10000,idempotencyKey:key}});
      }
    });
  }
  const employeeId=fixtureId('employee');
  await prisma.commerceEmployee.upsert({where:{id:employeeId},create:{id:employeeId,wecomUserId:scope,name:scope+' 模拟员工',referralCode:'SYSTEMQA909',departmentNames:['本地模拟测试'],active:true},update:{}});
  await prisma.commerceEmployeeWallet.upsert({where:{employeeId},create:{employeeId},update:{}});
  result.employee={id:employeeId,referralCode:'SYSTEMQA909',token:sign({sub:employeeId,typ:'employee'},profile.EMPLOYEE_TOKEN_SECRET,{algorithm:'HS256',expiresIn:'12h',issuer:'saydianapp-server',audience:'saydian-commerce-employee'}),expiresAt:new Date(Date.now()+12*3600000).toISOString()};
  const productId=fixtureId('product');
  await prisma.commerceProduct.upsert({where:{id:productId},create:{id:productId,erpItemId:scope,source:'LOCAL',name:scope+' 多规格流程测试商品',displayName:'流程测试商品（合成）',subtitle:'仅用于注册、分包发货、退款、权限验证，禁止真实销售',status:'PUBLISHED',featured:false,gallery:[],tags:['合成测试','不可真实销售']},update:{}});
  for(const [index,stock,price,enabled] of [[1,200,9900,true],[2,200,14900,true],[3,0,19900,true],[4,20,29900,false]]){
    await prisma.commerceSku.upsert({where:{id:fixtureId('sku'+index)},create:{id:fixtureId('sku'+index),productId,erpItemId:scope,erpSkuId:scope+':sku'+index,specification:'测试规格'+index,stock,salePriceCents:price,enabled},update:{}});
  }
  result.productId=productId;result.skuIds=[1,2,3,4].map(i=>fixtureId('sku'+i));
  const member=result.members[0];
  const login=await call(mall+'/auth/password/login',{method:'POST',body:{mobile:member.mobile,password},expected:[200,201]});
  await call(mall+'/auth/referral',{method:'POST',token:login.token,body:{referralCode:'SYSTEMQA909'},expected:[200,201]});
  const specs=[['pending',1],['cancelled',1],['paid',2],['split-shipment',3],['received',2],['after-sale',3]];
  for(const [name,quantity] of specs){
    const idempotencyKey=scope+':order:'+name;
    let order=await prisma.commerceOrder.findUnique({where:{idempotencyKey}});
    if(!order){
      const body={addressId:member.addressId,items:[{skuId:fixtureId('sku1'),quantity},{skuId:fixtureId('sku2'),quantity:1}],pointCents:500,buyerRemark:scope+' '+name+'；全部资产为模拟数据'};
      const quote=await call(mall+'/storefront/orders/preview',{method:'POST',token:login.token,body,expected:[200,201]});
      order=await call(mall+'/storefront/orders',{method:'POST',token:login.token,body,key:idempotencyKey,expected:[200,201]});
      check(order.payableCents,quote.quote.payableCents,'Created order matches server quote');
    }else check(order.userId,member.id,'Existing scenario order belongs to known member');
    if(name==='cancelled' && order.status==='PENDING_PAYMENT') await call(mall+'/storefront/orders/'+order.id+'/cancel',{method:'POST',token:login.token,expected:[200,201]});
    result.orders=result.orders.filter(x=>x.name!==name);result.orders.push({name,id:order.id,orderNo:order.orderNo});await save();
  }
  // Retained, visibly synthetic non-commerce scenarios for manual admin exploration.
  const appSessions=[];
  for(const member of result.members.slice(0,2))appSessions.push(await call(app+'/auth/login',{method:'POST',body:{mobile:member.mobile,password},expected:[200,201]}));
  const samples=[['heart_rate',{bpm:72}],['steps',{value:6000}],['sleep',{totalMinutes:420,deepMinutes:90,lightMinutes:330}],['body_composition',{bmi:22.4,weightKg:65}],['blood_oxygen',{percent:98}]];
  for(const [i,session] of appSessions.entries()){
    const records=samples.map(([metric,values])=>({id:scope+':'+i+':'+metric,metric,observedAt:'2026-09-08T00:00:00.000Z',timezoneOffsetMinutes:480,values,quality:'unknown',source:{platform:'migration',model:scope+' 合成样本，非真实测量'}}));
    const ingest=await call(app+'/health/records/batch',{method:'POST',token:session.accessToken,key:scope+':health:'+i,body:{records},expected:[200,201]});
    check(ingest.acceptedIds.length,records.length,'Retained synthetic health records');
  }
  let relationship=await prisma.careRelationship.findFirst({where:{inviterId:result.members[0].id,recipientId:result.members[1].id}});
  if(!relationship){
    relationship=await call(app+'/care/invitations',{method:'POST',token:appSessions[0].accessToken,body:{mobile:result.members[1].mobile},expected:[200,201]});
    await call(app+'/care/relationships/'+relationship.id+'/respond',{method:'POST',token:appSessions[1].accessToken,body:{accepted:true},expected:[200,201]});
    await call(app+'/care/relationships/'+relationship.id+'/permissions',{method:'POST',token:appSessions[1].accessToken,body:{metrics:['heart_rate','steps']},expected:[200,201]});
  }
  result.careId=relationship.id;
  if(!await prisma.feedback.findFirst({where:{userId:result.members[0].id,content:scope+' 模拟反馈：请协助核对订单包裹，仅测试不需要联系客户'}})){
    await call(app+'/support/feedback',{method:'POST',token:appSessions[0].accessToken,body:{category:'SYSTEM-QA',content:scope+' 模拟反馈：请协助核对订单包裹，仅测试不需要联系客户'},expected:[200,201]});
  }
  let category=await prisma.articleCategory.findFirst({where:{name:scope+' 合成内容分类'}});
  if(!category)category=await call(admin+'/article-categories',{method:'POST',token:adminSession.token,body:{name:scope+' 合成内容分类'},expected:[200,201]});
  for(const status of ['DRAFT','PUBLISHED']){
    const title=scope+' 合成文章 '+status;
    if(!await prisma.article.findFirst({where:{title}}))await call(admin+'/articles',{method:'POST',token:adminSession.token,body:{title,status,categoryId:category.id,publishedAt:status==='PUBLISHED'?'2026-09-08T00:00:00.000Z':null,summary:'仅用于测试富文本、列表和发布状态',contentHtml:'<h2>系统模拟测试内容</h2><p>本页是合成测试数据，不是正式产品说明、健康建议或真实用户评价。</p>'},expected:[200,201]});
  }
  const campaignName=scope+' 不发送的通知草稿';
  if(!await prisma.notificationCampaign.findFirst({where:{name:campaignName}}))await call(admin+'/notification-campaigns',{method:'POST',token:adminSession.token,body:{name:campaignName,title:'SYSTEM-QA 合成通知',body:'只保存草稿，不排期、不对外发送',audience:{userIds:result.members.map(x=>x.id)}},expected:[200,201]});
  await save();
  require('reflect-metadata');require('ts-node/register/transpile-only');
  const {BillingService}=require(join(repo,'apps/api/src/billing/billing.service.ts'));
  const callbackKey=randomBytes(32), identity={merchantId:'SYSTEM_QA_FAKE_MERCHANT',appId:'SYSTEM_QA_FAKE_APP'};
  const fake={identity:async()=>identity,assertIdentity:async intent=>{check(intent.providerMerchantId,identity.merchantId,'Fake merchant');},
    create:async()=>({type:'LOCAL_QA_ONLY',scope}),
    decodeWechatNotification:async(headers,body,raw)=>{check(headers.signature,createHmac('sha256',callbackKey).update(raw).digest('hex'),'Local callback signature');check(body.fixtureScope,scope,'Synthetic callback scope');return body.resource;}};
  const billing=new BillingService(prisma,fake,{});
  for(const scenario of result.orders.filter(x=>!['pending','cancelled'].includes(x.name))){
    const order=await prisma.commerceOrder.findUniqueOrThrow({where:{id:scenario.id}});
    if(order.status!=='PENDING_PAYMENT')continue;
    const payment=await billing.createPayment(member.id,{businessType:'commerce_order',businessId:order.id,channel:'wechat_h5',idempotencyKey:scope+':payment:'+scenario.name},{clientIp:'127.0.0.1'});
    const body={id:scope+':paid:'+scenario.name,fixtureScope:scope,resource:{out_trade_no:payment.paymentNo,transaction_id:scope+':txn:'+scenario.name,trade_state:'SUCCESS',mchid:identity.merchantId,appid:identity.appId,amount:{total:payment.amountCents,currency:'CNY'}}};
    const raw=Buffer.from(JSON.stringify(body));await billing.handleWechatNotification({signature:createHmac('sha256',callbackKey).update(raw).digest('hex')},body,raw);
    check((await prisma.commerceOrder.findUniqueOrThrow({where:{id:order.id}})).status,'PAID','Real domain transition using a local injected adapter');
  }
  await call(admin+'/auth/logout',{method:'POST',token:adminSession.token,expected:[200,201]});
  result.lastVerifiedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({passed:true,scope,requests,assertions,members:result.members.map(({mobile,nickname})=>({mobile,nickname})),roles:result.admins.map(x=>x.role),orders:result.orders,privateAccountsFile:privatePath,boundary:'Synthetic-only local assets retained; no supplier calls or real financial receipts'},null,2));
} finally {await prisma.$disconnect();}
