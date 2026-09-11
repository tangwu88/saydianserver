import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { realmTestModules } from '../../../tools/h5-realm-fixture.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('vue/compiler-sfc');
function evaluate(source,imports,globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Error,...globals,require(name){assert.ok(Object.hasOwn(imports,name),'Unexpected import '+name);return imports[name];}});return module.exports;}
function compile(name){const filename=new URL(`../src/pages/${name}/index.vue`,import.meta.url).pathname,descriptor=parse(readFileSync(new URL(`../src/pages/${name}/index.vue`,import.meta.url),'utf8'),{filename}).descriptor;
  const script=compileScript(descriptor,{id:name});const template=compileTemplate({source:descriptor.template.content,filename,id:name,compilerOptions:{bindingMetadata:script.bindings,isCustomElement:tag=>tag===tag.toLowerCase()}});assert.deepEqual(template.errors,[]);
  return {script:script.content,render:evaluate(template.code,{vue:{...vue,withDirectives:node=>node}}).render};}
const compiled={'after-sale':compile('after-sale'),'order-detail':compile('order-detail')};
const model=evaluate(readFileSync(new URL('../src/commerce-model.ts',import.meta.url),'utf8'),{});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function nodes(node){return !node||typeof node!=='object'?[]:[node,...(Array.isArray(node.children)?node.children.flatMap(nodes):[])];}
function text(node){return typeof node?.children==='string'?node.children:Array.isArray(node?.children)?node.children.map(text).join(''):'';}
const button=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&text(node)===label);
const copy=value=>JSON.parse(JSON.stringify(value));
function page(name,handler,options={}){const hooks={},requests=[],navigations=[],notices=[],store=options.store||new Map();let session='member-a-session';
  const uni={getStorageSync:key=>store.get(key),setStorageSync:(key,value)=>store.set(key,value),removeStorageSync:key=>store.delete(key),getStorageInfoSync:()=>({keys:[...store.keys()]}),getSystemInfoSync:()=>({windowWidth:390}),redirectTo:value=>navigations.push(value.url),navigateTo:value=>navigations.push(value.url),showModal:options.modal||(()=>Promise.resolve({confirm:true}))};
  const {realm}=realmTestModules(uni,{env:{VITE_APP_REALM:'global'}});realm.mallStorage.set('saidian-user',{id:options.userId||'member-a'});realm.mallStorage.set('saidian-token','synthetic-token');
  const value=compiled[name];const component=evaluate(value.script,{vue,'../../realm':realm,'../../components/DesktopHeader.vue':{default:{render:()=>null}},'@dcloudio/uni-app':Object.fromEntries(['Load','Show','Hide','Unload'].map(event=>['on'+event,callback=>hooks[event.toLowerCase()]=callback])),
    '../../components/ImageEvidencePicker.vue':{default:{render:()=>null}},'../../after-sale-images':{validEvidenceIds:ids=>Array.isArray(ids)&&ids.length<=9&&ids.every(id=>/^[0-9a-f-]{36}$/.test(id))},
    '../../commerce-model':model,'../../api':{api:async(path,input={})=>{requests.push({path,input});return handler(path,input,requests.length);},money:value=>value==null?'未获取':`¥${(value/100).toFixed(2)}`,toast:value=>notices.push(String(value)),requireLogin:()=>true,mallSessionStamp:()=>session},
    '../../payments':{confirmPayment:options.confirmPayment||(()=>Promise.resolve({paid:false})),createOrderPayment:options.createOrderPayment||(()=>{throw Error('Unexpected payment creation');}),invokePayment:options.invokePayment||(()=>Promise.resolve({})),paymentEnvironment:()=> 'wechat',paymentLabels:{wechat_jsapi:'微信支付'}},
  },{uni,setInterval:()=>123,clearInterval(){}}).default;
  const state=component.setup({},{expose(){}}),ui=vue.proxyRefs(state);hooks.load(name==='after-sale'?{orderId:'order-a'}:{id:'order-a'});
  return {state,hooks,requests,navigations,notices,store,storage:realm.mallStorage,setSession:value=>{session=value;},tree:()=>value.render({},[],{},ui,{},{}),async show(){hooks.show();await tick();}};
}
const item=(id='item-a')=>({id,nameSnapshot:'测试商品 '+id,specificationSnapshot:'白色',quantity:3,unitPriceCents:1000});
const order=(changes={})=>({id:'order-a',orderNo:'TEST-A',status:'RECEIVED',readOnly:false,items:[item()],allowedActions:['APPLY_AFTER_SALE'],afterSaleEligibleItems:[{orderItemId:'item-a',quantityRemaining:2,cashRemainingCents:1600,pointRemainingCents:400}],afterSales:[],shipments:[],...changes});
const quote=(changes={})=>({orderVersion:2,type:'REFUND_ONLY',requestedCents:800,merchandiseRefundCents:800,shippingRefundCents:0,pointReturnCents:200,items:[{orderItemId:'item-a',quantity:1,amountCents:800,pointReturnCents:200}],...changes});
function normal(path){if(path==='/storefront/capabilities')return {payments:[]};if(path.endsWith('/preview'))return quote();return order();}

test('after-sale real SFC retries loading and displays current per-item remaining cash, points and quantity',async()=>{
  let fail=true;const h=page('after-sale',()=>{if(fail)throw Error('订单读取失败');return order();});await h.show();assert.ok(button(h.tree(),'刷新订单与剩余额度'));assert.equal(h.state.order.value,null);
  fail=false;await button(h.tree(),'刷新订单与剩余额度').props.onClick();assert.match(text(h.tree()),/剩余可申请 2 件/);assert.match(text(h.tree()),/¥16.00/);assert.match(text(h.tree()),/¥4.00/);
  h.state.lines.value[0].available.cashRemainingCents=null;assert.match(text(h.tree()),/剩余商品现金 未获取/);
  h.hooks.hide();assert.equal(h.state.order.value,null);await h.show();assert.equal(h.state.lines.value[0].quantity,0);
});
test('read-only or ineligible order never obtains artificial available quantities from its item count',async()=>{
  for(const value of [order({readOnly:true}),order({allowedActions:[]})]){const h=page('after-sale',()=>value);await h.show();assert.equal(h.state.lines.value[0].available.quantityRemaining,0);assert.equal(button(h.tree(),'确认提交申请').props.disabled,true);}
});
test('after-sale preview rejects old responses and submitting locks type and quantity to the quoted request',async()=>{
  const a=deferred(),b=deferred();let count=0;const h=page('after-sale',(path)=>path.endsWith('/preview')?(++count===1?a.promise:count===2?b.promise:quote({requestedCents:1600})):order());await h.show();const line=h.state.lines.value[0];h.state.change(line,1);h.state.change(line,1);b.resolve(quote({requestedCents:1600}));await tick();a.resolve(quote());await tick();assert.equal(h.state.quote.value.requestedCents,1600);
  h.state.busy.value=true;h.state.change(line,-1);h.state.selectType({detail:{value:1}});assert.equal(line.quantity,2);assert.equal(h.state.typeIndex.value,0);assert.equal(nodes(h.tree()).find(node=>node.type==='picker').props.disabled,true);
});
test('network-uncertain after-sale survives reload and retries the same payload/key without fresh quote or version',async()=>{
  const h=page('after-sale',(path)=>{if(path.endsWith('/after-sales'))throw Error('connection lost');return normal(path);});await h.show();h.state.lines.value[0].quantity=1;h.state.reason.value='测试退货原因';await h.state.preview();await h.state.submit();
  const original=copy(h.requests.find(row=>row.path.endsWith('/after-sales')).input.data);assert.match(original.idempotencyKey,/^h5-after-sale-/);assert.equal(original.orderVersion,2);assert.ok(h.state.frozen.value);
  const next=page('after-sale',(path)=>{if(path.endsWith('/after-sales'))return {id:'sale-a'};return order({allowedActions:[],afterSaleEligibleItems:[]});},{store:h.store});await next.show();assert.ok(next.state.frozen.value);await next.state.submit();
  assert.deepEqual(copy(next.requests.find(row=>row.path.endsWith('/after-sales')).input.data),original);assert.equal(next.requests.some(row=>row.path.endsWith('/preview')),false);assert.deepEqual(next.navigations,['/pages/order-detail/index?id=order-a']);assert.equal(next.storage.get('after-sale-drafts').orders['order-a'],undefined);
});
test('pending or failed image blocks new submission and successful IDs are frozen and restored without replacing the original request',async()=>{
  const imageId='12345678-1234-4234-8234-123456789012';
  const h=page('after-sale',path=>{if(path.endsWith('/after-sales'))throw Error('connection lost');return normal(path);});await h.show();h.state.lines.value[0].quantity=1;h.state.reason.value='问题图片测试';await h.state.preview();h.state.evidenceBlocked.value=true;
  assert.equal(button(h.tree(),'确认提交申请').props.disabled,true);await h.state.submit();assert.equal(h.requests.some(row=>row.path.endsWith('/after-sales')),false);
  h.state.evidenceBlocked.value=false;h.state.evidenceIds.value=[imageId];await h.state.submit();const original=copy(h.requests.find(row=>row.path.endsWith('/after-sales')).input.data);assert.deepEqual(original.evidenceFileIds,[imageId]);assert.equal(Object.hasOwn(original,'evidenceImages'),false);
  const next=page('after-sale',path=>path.endsWith('/after-sales')?{id:'sale-a'}:order(),{store:h.store});await next.show();assert.deepEqual(copy(next.state.evidenceIds.value),[imageId]);next.state.evidenceIds.value=[];await next.state.submit();assert.deepEqual(copy(next.requests.find(row=>row.path.endsWith('/after-sales')).input.data),original);
});
test('after-sale frozen drafts are never restored for a different member, and hidden preview cannot repaint or submit',async()=>{
  const slow=deferred(),h=page('after-sale',path=>path.endsWith('/preview')?slow.promise:order());h.storage.set('after-sale-drafts',{userId:'member-b',orders:{'order-a':{idempotencyKey:'foreign-key'}}});await h.show();assert.equal(h.state.frozen.value,null);
  h.state.lines.value[0].quantity=1;const pending=h.state.preview();h.hooks.hide();slow.resolve(quote());await pending;assert.equal(h.state.quote.value,null);await h.state.submit();assert.equal(h.requests.some(row=>row.path.endsWith('/after-sales')),false);
});
test('after-sale confirmed version conflict requires reloading remaining quantities, not silently changing the frozen request',async()=>{
  const h=page('after-sale',path=>{if(path.endsWith('/after-sales'))throw Object.assign(Error('订单已更新'),{status:409});return normal(path);});await h.show();h.state.lines.value[0].quantity=1;h.state.reason.value='原因';await h.state.preview();await h.state.submit();assert.equal(h.state.frozen.value,null);assert.equal(h.state.quote.value,null);assert.match(h.state.error.value,/核对订单售后记录/);const count=h.requests.length;await h.state.submit();assert.equal(h.requests.length,count);
});
test('a changed order version requires confirmation even when refund amounts did not change',async()=>{
  let previews=0;const h=page('after-sale',path=>path.endsWith('/preview')?quote({orderVersion:++previews===1?2:3}):order());await h.show();h.state.lines.value[0].quantity=1;h.state.reason.value='原因';await h.state.preview();await h.state.submit();assert.equal(h.requests.some(row=>row.path.endsWith('/after-sales')),false);assert.match(h.state.error.value,/订单或可退金额已更新/);assert.equal(h.state.quote.value.orderVersion,3);
});
test('another tab frozen request appearing during preview is reused without replacement or repricing it',async()=>{
  const pending=deferred();let previews=0;const h=page('after-sale',path=>path.endsWith('/preview')?(++previews===1?quote():pending.promise):path.endsWith('/after-sales')?{id:'existing-sale'}:order());await h.show();h.state.lines.value[0].quantity=1;h.state.reason.value='原因';await h.state.preview();const submit=h.state.submit();
  const payload={idempotencyKey:'same-tab-original-key',orderVersion:1,type:'RETURN_REFUND',items:[{orderItemId:'item-a',quantity:2}],requestedCents:1600,reason:'另一标签原申请',description:'',evidenceImages:[]};h.storage.set('after-sale-drafts',{userId:'member-a',orders:{'order-a':payload}});pending.resolve(quote({orderVersion:3}));await submit;assert.deepEqual(copy(h.requests.find(row=>row.path.endsWith('/after-sales')).input.data),payload);assert.deepEqual(h.navigations,['/pages/order-detail/index?id=order-a']);
});
test('order renders actual traceJson packages, per-item after-sales and real refund states without treating application as paid',async()=>{
  const value=order({items:[item(),item('item-b')],shipments:[{id:'p1',trackingNo:'TRACK1',items:[{orderItemId:'item-a',quantity:1}],traceJson:[{context:'已揽收',time:'2026-09-11T00:00:00Z'}]},{id:'p2',trackingNo:'TRACK2',items:[{orderItemId:'item-b',quantity:2}],traceJson:{data:[{description:'运输中',time:'invalid'}]}}],afterSales:[{id:'sale',type:'REFUND_ONLY',status:'REFUNDING',reason:'质量问题',requestedCents:800,pointReturnCents:null,items:[{orderItemId:'item-a',quantity:1}],refunds:[{id:'refund',status:'PROCESSING',amountCents:800}]}]});
  const h=page('order-detail',path=>path==='/storefront/capabilities'?{payments:[]}:value);await h.show();const content=text(h.tree());assert.match(content,/包裹 1/);assert.match(content,/包裹 2/);assert.match(content,/已揽收/);assert.match(content,/运输中/);assert.match(content,/时间未获取/);assert.equal(content.includes('Invalid Date'),false);assert.match(content,/退款处理中/);assert.match(content,/预计返还积分抵扣 未获取/);assert.equal(content.includes('已退款 ·'),false);
});
test('order latest reload wins and leaving page clears private forms while delayed old response cannot repaint',async()=>{
  const a=deferred(),b=deferred();let count=0;const h=page('order-detail',path=>path==='/storefront/capabilities'?{payments:[]}:(++count===1?a.promise:b.promise));h.hooks.show();const second=h.state.load();b.resolve(order({orderNo:'newest'}));await second;a.resolve(order({orderNo:'older'}));await tick();assert.equal(h.state.order.value.orderNo,'newest');
  h.state.reviewText.value='private content';h.state.returnTracking.value='private tracking';h.hooks.hide();assert.equal(h.state.order.value,null);assert.equal(h.state.reviewText.value,'');assert.equal(h.state.returnTracking.value,'');
});
test('order request resolving after account switch or page hide never restores private data',async()=>{
  for(const change of [h=>h.setSession('member-b-session'),h=>h.hooks.hide()]){const pending=deferred(),h=page('order-detail',path=>path==='/storefront/capabilities'?{payments:[]}:pending.promise);h.hooks.show();change(h);pending.resolve(order());await tick();assert.equal(h.state.order.value,null);}
});
test('order loading error has a real retry and retains server-authorized remaining-sale action after an earlier partial refund',async()=>{
  let fail=true;const h=page('order-detail',path=>{if(path==='/storefront/capabilities')return {payments:[]};if(fail)throw Error('订单暂不可读');return order({status:'AFTER_SALE',afterSales:[{id:'old-sale',status:'COMPLETED',type:'REFUND_ONLY',requestedCents:800,items:[{orderItemId:'item-a',quantity:1}],refunds:[{id:'old-refund',status:'SUCCEEDED',amountCents:800}]}]});});await h.show();assert.ok(button(h.tree(),'重新加载'));fail=false;await button(h.tree(),'重新加载').props.onClick();assert.ok(button(h.tree(),'申请商品售后'));button(h.tree(),'申请商品售后').props.onClick();assert.deepEqual(h.navigations,['/pages/after-sale/index?orderId=order-a']);assert.match(text(h.tree()),/已退款 · ¥8.00/);
});
test('account switch during receipt confirmation prevents an outbound mutation using the new account',async()=>{
  const modal=deferred(),h=page('order-detail',path=>path==='/storefront/capabilities'?{payments:[]}:order({status:'SHIPPED',allowedActions:['CONFIRM_RECEIPT']}),{modal:()=>modal.promise});await h.show();const action=h.state.action('receipt','确认');h.setSession('member-b-session');modal.resolve({confirm:true});await action;assert.equal(h.requests.some(row=>row.input.method==='POST'),false);
});
test('review uses owned server item, suppresses duplicate clicks and shows server-provided reviewed state',async()=>{
  const post=deferred(),h=page('order-detail',(path,input)=>path==='/storefront/capabilities'?{payments:[]}:input.method==='POST'?post.promise:order());await h.show();h.state.openReview(h.state.order.value.items[0]);h.state.reviewText.value='真实使用体验';const pending=h.state.review();await h.state.review();assert.equal(h.requests.filter(row=>row.path==='/storefront/reviews').length,1);post.resolve({id:'review-a',rating:5,content:'真实使用体验'});await pending;assert.match(text(h.tree()),/已评价 · 5 星/);assert.equal(button(h.tree(),'评价商品'),undefined);
  h.state.reviewItem.value='other-member-item';h.state.reviewText.value='x';await h.state.review();assert.equal(h.requests.filter(row=>row.input.method==='POST').length,1);
});
test('an in-flight review completing after hide neither shows success nor restores the review form',async()=>{
  const pending=deferred(),h=page('order-detail',(path,input)=>path==='/storefront/capabilities'?{payments:[]}:input.method==='POST'?pending.promise:order());await h.show();h.state.openReview(h.state.order.value.items[0]);h.state.reviewText.value='旧账号内容';const review=h.state.review();h.hooks.hide();pending.resolve({id:'review-a',rating:5});await review;assert.equal(h.state.order.value,null);assert.equal(h.state.reviewText.value,'');assert.deepEqual(h.notices,[]);
});
test('server-owned existing review is displayed and not offered as a fresh review after reload',async()=>{
  const h=page('order-detail',path=>path==='/storefront/capabilities'?{payments:[]}:order({items:[{...item(),review:{id:'review-existing',rating:4,content:'已提交',published:false}}]}));await h.show();assert.match(text(h.tree()),/已评价 · 4 星/);assert.equal(button(h.tree(),'评价商品'),undefined);h.state.openReview(h.state.order.value.items[0]);assert.equal(h.state.reviewItem.value,'');
});
test('return logistics requires exact eligible type and owner, sends current version, and never marks refund as completed',async()=>{
  const sale={id:'sale-a',version:3,executionOwner:'NEW_SYSTEM',type:'RETURN_REFUND',status:'WAITING_RETURN'};const h=page('order-detail',(path,input)=>path==='/storefront/capabilities'?{payments:[]}:input.method==='POST'?sale:order({afterSales:[sale]}));await h.show();assert.equal(h.state.returnable({...sale,type:'REFUND_ONLY'}),false);assert.equal(h.state.returnable({...sale,executionOwner:'LEGACY'}),false);h.state.editReturn(sale);h.state.returnCompany.value='测试快递';h.state.returnTracking.value='TEST0001';await h.state.saveReturn();const request=h.requests.find(row=>row.path.endsWith('/return-logistics'));assert.equal(request.input.data.version,3);assert.equal(request.input.data.trackingNo,'TEST0001');assert.equal(h.state.order.value.afterSales[0].status,'WAITING_RETURN');
});
test('submitted sale exposes only canonical private IDs, never external evidence URLs',async()=>{const id='12345678-1234-4234-8234-123456789012',h=page('order-detail',()=>order({afterSales:[{id:'sale-a',status:'REQUESTED',evidenceImages:['file:'+id,'https://foreign.example/image',id,'file:'+id]}]}));await h.show();assert.deepEqual(copy(h.state.saleEvidenceIds(h.state.order.value.afterSales[0].evidenceImages)),[id]);const viewer=nodes(h.tree()).find(node=>node.props?.['model-value']);assert.deepEqual(copy(viewer.props['model-value']),[id]);assert.equal(viewer.props.readonly,'');assert.equal(text(h.tree()).includes('foreign.example'),false);});
