// Real HTTP acceptance for retained SYSTEM-QA fixtures; no provider adapter or real funds.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { validateDemoProfile } from './h5-demo-profile.mjs';

assert.equal(process.env.RUN_SYSTEM_QA, '1');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..'), profilePath=process.argv[2];
const profile=parseEnv(await readFile(profilePath,'utf8')); validateDemoProfile(profile,repo,profilePath);
const qa=JSON.parse(await readFile(join(dirname(profilePath),'system-qa-accounts.json'),'utf8'));
assert.equal(qa.scope,'SYSTEM-QA-20260909');
Object.assign(process.env,{NODE_ENV:'development',H5_DEMO_ENABLED:'true'});
const require=createRequire(join(repo,'apps/api/package.json')); require(join(repo,'tools/h5-demo-network-guard.cjs'));
const {PrismaClient}=require('@prisma/client');
const prisma=new PrismaClient({datasources:{db:{url:profile.DATABASE_URL}}});
const matrix=JSON.parse(execFileSync(process.execPath,[join(repo,'tools/system-qa-role-matrix.mjs'),repo,'--json'],{encoding:'utf8',windowsHide:true,maxBuffer:2_000_000}));
const admin='/api/saydian-app/admin/v1',mall='/api/saidian-mall/v1';
let requests=0,assertions=0; const checks=[],restores=[],sessions=[];
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);assertions++;};
async function http(path,{method='GET',token,body,expected=200}={}){
  const r=await fetch('http://127.0.0.1:8081'+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});requests++;
  const text=await r.text();assert.ok(!/PrismaClient|postgres(?:ql)?:\/\/|-----BEGIN .* KEY-----|node_modules/.test(text),'No internal diagnostics');assertions++;
  assert.ok((Array.isArray(expected)?expected:[expected]).includes(r.status),`${method} ${path}: expected ${expected}, got ${r.status}`);assertions++;
  let json;try{json=JSON.parse(text);}catch{json=text;}
  return json?.data??json;
}
const loginAdmin=async row=>{const login=await http(admin+'/auth/login',{method:'POST',body:{username:row.username,password:qa.password},expected:[200,201]});sessions.push(login.token);return login.token;};
try{
  eq(await prisma.integrationSecret.count(),0,'No live provider secrets');
  eq(await prisma.integrationConfig.count({where:{state:'CONFIGURED'}}),0,'Channels stay unconfigured');
  const tokens={};
  for(const account of qa.admins){
    const row=await prisma.adminUser.findUniqueOrThrow({where:{id:account.id}});eq(row.displayName,qa.scope+' '+account.role,'Scoped admin');
    const token=tokens[account.role]=await loginAdmin(account);
    for(const route of matrix.routes.filter(x=>x.method==='GET'&&!x.path.includes(':'))){
      await http(route.path,{token,expected:route.allowed.includes(account.role)?200:403});
    }
  }
  checks.push('10 roles: real GET authorization and successful allowed list endpoints');
  const member=qa.members[0], other=qa.members[1], inactive=qa.members[2];
  const consumer=async mobile=>http(mall+'/auth/password/login',{method:'POST',body:{mobile,password:qa.password},expected:[200,201]});
  const A=await consumer(member.mobile),B=await consumer(other.mobile),C=await consumer(inactive.mobile);
  eq(A.user.id,member.id,'Same member identity');
  await http(admin+'/commerce-orders',{token:A.token,expected:401});
  await http(mall+'/storefront/orders',{token:tokens.COMMERCE_OPERATIONS,expected:401});
  const row=await prisma.user.findUniqueOrThrow({where:{id:inactive.id}});eq(row.nickname,inactive.nickname,'Owned status fixture');eq(row.status,'ACTIVE','Status fixture starts active');
  await prisma.user.update({where:{id:inactive.id},data:{status:'DISABLED'}});
  restores.push(async()=>{const r=await prisma.user.updateMany({where:{id:inactive.id,nickname:inactive.nickname,status:'DISABLED'},data:{status:'ACTIVE'}});eq(r.count,1,'Only restore owned expected inactive status');});
  await http(mall+'/auth/password/login',{method:'POST',body:{mobile:inactive.mobile,password:qa.password},expected:401});
  const recentSms=await prisma.smsCode.findFirst({where:{mobile:inactive.mobile},orderBy:{createdAt:'desc'}});
  const cooldown=recentSms?Math.max(0,recentSms.createdAt.valueOf()+60_100-Date.now()):0;
  if(cooldown) { console.log('Respecting local SMS retry cooldown'); await new Promise(resolve=>setTimeout(resolve,Math.min(cooldown,60_000))); }
  const otp=await http(mall+'/auth/sms/request',{method:'POST',body:{mobile:inactive.mobile},expected:[200,201]});
  await http(mall+'/auth/sms/login',{method:'POST',body:{mobile:inactive.mobile,code:otp.devCode,consentVersion:'system-qa-local-nonbinding'},expected:[401,403]});
  await http(mall+'/storefront/points',{token:C.token,expected:401});
  eq((await prisma.user.findUniqueOrThrow({where:{id:inactive.id}})).status,'DISABLED','SMS cannot reactivate disabled member');
  await restores.pop()();checks.push('Inactive account rejects password, SMS and existing session without reactivation');
  const scoped=qa.orders.find(x=>x.name==='paid');
  for(const suffix of ['', '/logistics']) await http(mall+'/storefront/orders/'+scoped.id+suffix,{token:B.token,expected:404});
  await http(mall+'/storefront/orders/'+scoped.id+'/receipt',{method:'POST',token:B.token,expected:409});
  await http(admin+'/commerce-orders/'+scoped.id+'/fulfillment-preview',{token:tokens.FINANCE,expected:403});
  await http(admin+'/commerce-orders/'+scoped.id+'/shipments',{method:'POST',token:tokens.READ_ONLY,body:{},expected:403});
  const preview=id=>http(admin+'/commerce-orders/'+id+'/fulfillment-preview',{token:tokens.COMMERCE_OPERATIONS});
  const ship=(id,body,expected=[200,201])=>http(admin+'/commerce-orders/'+id+'/shipments',{method:'POST',token:tokens.COMMERCE_OPERATIONS,body,expected});
  const split=qa.orders.find(x=>x.name==='split-shipment');
  let p=await preview(split.id);
  const firstTracking=qa.scope+'-SPLIT-1';
  const existing=p.shipments.find(x=>x.trackingNo===firstTracking);
  const body={version:p.version,logisticsCompany:'SYSTEM-QA 模拟承运（未实际发货）',trackingNo:firstTracking,items:existing?.items.map(({orderItemId,quantity})=>({orderItemId,quantity}))||[{orderItemId:p.items[0].orderItemId,quantity:1}]};
  const first=await ship(split.id,body);
  const replay=await ship(split.id,body);eq(replay.replayed,true,'Exact shipment replay');eq(replay.shipmentId,first.shipmentId,'Same parcel identity');
  p=await preview(split.id);
  eq(p.shipments.filter(x=>x.trackingNo===firstTracking).length,1,'Initial partial parcel exists exactly once');eq(p.status,'WAITING_FULFILLMENT','Partial stays waiting');
  await ship(split.id,{...body,trackingNo:qa.scope+'-STALE',version:p.version-1},409);
  await ship(split.id,{...body,version:p.version,items:[{orderItemId:body.items[0].orderItemId,quantity:body.items[0].quantity+1}]},409);
  await ship(split.id,{...body,version:p.version,trackingNo:qa.scope+'-OVER',items:[{orderItemId:p.items[0].orderItemId,quantity:999}]},409);
  if(!p.shipments.some(x=>x.trackingNo.startsWith(qa.scope+'-RACE-'))){
    const line=p.items.find(x=>x.remainingQuantity>=2);assert.ok(line,'Fresh race fixture retains at least two units');
    const outcomes=await Promise.all(['A','B'].map(label=>ship(split.id,{...body,version:p.version,trackingNo:qa.scope+'-RACE-'+label,items:[{orderItemId:line.orderItemId,quantity:1}]},[200,201,409])));
    eq(outcomes.filter(x=>x.shipmentId).length,1,'Only one concurrent same-version shipment commits');
    p=await preview(split.id);eq(p.shipments.filter(x=>x.trackingNo.startsWith(qa.scope+'-RACE-')).length,1,'Losing concurrency request created no parcel');
  }
  const partialDetail=await http(mall+'/storefront/orders/'+split.id,{token:A.token});
  eq(partialDetail.shipments.length,p.shipments.length,'Customer sees all registered parcels');eq(partialDetail.shipments[0].items.length,1,'Parcel quantity mapping returned');
  assert.ok(!partialDetail.allowedActions.includes('CONFIRM_RECEIPT'),'Partial order cannot be fully received');assertions++;
  checks.push('Manual partial shipment: real HTTP, same-version concurrency, replay, stale version, carrier/content conflict, over-ship and customer visibility');
  for(const name of ['received','after-sale']){
    const scenario=qa.orders.find(x=>x.name===name);let p=await preview(scenario.id);
    if(['PAID','WAITING_FULFILLMENT'].includes(p.status)&&p.items.some(x=>x.remainingQuantity)){
      p=await ship(scenario.id,{version:p.version,logisticsCompany:'SYSTEM-QA 模拟承运（未实际发货）',trackingNo:qa.scope+'-'+name.toUpperCase(),items:p.items.filter(x=>x.remainingQuantity).map(x=>({orderItemId:x.orderItemId,quantity:x.remainingQuantity}))});
      eq(p.status,'SHIPPED','All remaining quantities shipped');
    }
    let order=await http(mall+'/storefront/orders/'+scenario.id,{token:A.token});
    if(name==='received'){
      if(order.status==='SHIPPED')await http(mall+'/storefront/orders/'+scenario.id+'/receipt',{method:'POST',token:A.token,expected:[200,201]});
      order=await http(mall+'/storefront/orders/'+scenario.id,{token:A.token});eq(order.status,'RECEIVED','Member confirms receipt');
      const item=order.items[0];if(!await prisma.commerceReview.findUnique({where:{orderItemId:item.id}}))await http(mall+'/storefront/reviews',{method:'POST',token:A.token,body:{orderItemId:item.id,rating:5,content:qa.scope+' 合成流程评价，不是实际使用评价',images:[]},expected:[200,201]});
    }else if(!order.afterSales?.length){
      const input={type:'RETURN_REFUND',reason:qa.scope+' 模拟商品级退货，未实际寄回',items:[{orderItemId:order.items[0].id,quantity:1}]};
      const quote=await http(mall+'/storefront/orders/'+scenario.id+'/after-sales/preview',{method:'POST',token:A.token,body:input,expected:[200,201]});
      const sale=await http(mall+'/storefront/orders/'+scenario.id+'/after-sales',{method:'POST',token:A.token,body:{...input,orderVersion:quote.orderVersion,requestedCents:quote.requestedCents},expected:[200,201]});
      eq(sale.status,'APPLIED','Merchandise return application remains auditable');
    }
  }
  checks.push('Full shipment, member receipt, synthetic review and item-level return application retained');
  const audit=await prisma.auditLog.count({where:{action:'COMMERCE_LOCAL_SHIPMENT_CREATE',actorId:qa.admins.find(x=>x.role==='COMMERCE_OPERATIONS').id}});
  assert.ok(audit>=3,'Real shipment audit entries');assertions++;
  const report={passed:true,requests,assertions,checks,scope:qa.scope,at:new Date().toISOString(),boundary:'Retained synthetic fixtures only; simulated carrier labels are not delivery or payment receipts'};
  await writeFile(join(dirname(profilePath),'system-qa-http-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  for(const restore of restores.reverse())await restore();
  for(const token of sessions)await http(admin+'/auth/logout',{method:'POST',token,expected:[200,201]});
  await prisma.$disconnect();
}
