import { api } from "./api";
import { isPaidStatus } from "./commerce-model";
export const paymentLabels: Record<string,string> = {wechat_jsapi:"微信支付",wechat_h5:"微信支付",wechat_native:"微信扫码",wechat_mini:"微信支付",alipay_wap:"支付宝",alipay_page:"支付宝",alipay_browser:"支付宝（浏览器付款）",wechat_open:"微信（微信内付款）"};
export function paymentEnvironment(): "wechat"|"browser"|"mini" {
  /* #ifdef MP-WEIXIN */
  return "mini";
  /* #endif */
  return typeof navigator !== "undefined" && /micromessenger/i.test(navigator.userAgent) ? "wechat" : "browser";
}
function paymentUrl(raw: unknown): string {
  const url = new URL(String(raw));
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port!=='443') || !["wx.tenpay.com","payapp.weixin.qq.com","mclient.alipay.com","openapi.alipay.com","openapi.alipaydev.com","openapi-sandbox.dl.alipaydev.com"].includes(url.hostname)) throw new Error("支付跳转地址不受信任");
  return url.href;
}
async function readyWechatBridge(): Promise<any> {
  const current = () => (window as any).WeixinJSBridge;
  if (typeof current()?.invoke === 'function') return current();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); document.removeEventListener('WeixinJSBridgeReady', ready); };
    const ready = () => { if (typeof current()?.invoke === 'function') { cleanup(); resolve(current()); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('微信支付组件未就绪，请重新打开本订单后重试')); }, 8000);
    document.addEventListener('WeixinJSBridgeReady', ready);
    ready();
  });
}
export async function invokePayment(invoke: any, isCurrent: () => boolean = () => true): Promise<{qr?:string;pending?:boolean;redirected?:boolean}> {
  if (!isCurrent()) throw new Error("账号或页面已变化，请重新打开订单");
  if (!invoke?.type) throw new Error("支付结果待确认，请在订单页刷新，不要重复下单");
  if (invoke.type === "QR") {
    if (!/^data:image\/png;base64,/.test(String(invoke.qrDataUrl))) throw new Error("支付二维码暂时无法显示，请稍后重试");
    return {qr:invoke.qrDataUrl};
  }
  /* #ifdef H5 */
  if (invoke.type === "REDIRECT") { window.location.assign(paymentUrl(invoke.url)); return {pending:true,redirected:true}; }
  if (invoke.type === "FORM") {
    const action = new URL(paymentUrl(invoke.url));
    const alipay = ["openapi.alipay.com","openapi.alipaydev.com","openapi-sandbox.dl.alipaydev.com"].includes(action.hostname);
    // Match Alipay's pageExecute transport: charset must be available before
    // the gateway decodes the POST body. Preserve all signed parameter values.
    const queryFields = new Set(["app_id","method","format","charset","sign_type","sign","timestamp","version","notify_url","return_url","auth_token","app_auth_token","app_cert_sn","alipay_root_cert_sn","ws_service_url"]);
    const form = document.createElement("form"); form.method="POST"; form.acceptCharset="UTF-8";
    for (const [key,value] of Object.entries(invoke.fields || {})) {
      if (alipay && queryFields.has(key)) { action.searchParams.set(key,String(value)); continue; }
      const input=document.createElement("input");input.type="hidden";input.name=key;input.value=String(value);form.appendChild(input);
    }
    form.action=action.href;
    document.body.appendChild(form);form.submit();return {pending:true,redirected:true};
  }
  if (invoke.type === "JSAPI") {
    if (!invoke.appId || !/^\d+$/.test(String(invoke.timeStamp)) || !invoke.nonceStr || !/^prepay_id=\S+$/.test(String(invoke.package)) || invoke.signType !== 'RSA' || !invoke.paySign) throw new Error('支付参数无效，请在订单页重试');
    const bridge = await readyWechatBridge();
    if (!isCurrent()) throw new Error("账号或页面已变化，请重新打开订单");
    await new Promise<void>((resolve,reject) => {
      const parameters = { appId: invoke.appId, timeStamp: String(invoke.timeStamp), nonceStr: invoke.nonceStr, package: invoke.package, signType: invoke.signType, paySign: invoke.paySign };
      bridge.invoke("getBrandWCPayRequest", parameters, (result:any) => {
        const status = result?.err_msg || result?.errMsg || '';
        return /:ok$/.test(status) ? resolve() : reject(new Error(/cancel/.test(status) ? "已取消支付，可从订单继续" : "微信支付未完成，请查看订单"));
      });
    });
    return {pending:true};
  }
  /* #endif */
  /* #ifdef MP-WEIXIN */
  if (invoke.type === "JSAPI") {
    if (!invoke.timeStamp || !invoke.nonceStr || !/^prepay_id=\S+$/.test(String(invoke.package)) || invoke.signType !== 'RSA' || !invoke.paySign) throw new Error('支付参数无效，请在订单页重试');
    await new Promise((resolve,reject)=>uni.requestPayment({provider:'wxpay',timeStamp:String(invoke.timeStamp),nonceStr:invoke.nonceStr,package:invoke.package,signType:'RSA',paySign:invoke.paySign,success:resolve,fail:()=>reject(new Error('微信支付未完成，可在订单页继续付款'))})); return {pending:true};
  }
  /* #endif */
  throw new Error("当前环境不支持此支付方式");
}
export async function createOrderPayment(orderId:string,channel:string) {
  if (["alipay_browser","wechat_open"].includes(channel.toLowerCase())) throw new Error("请在对应浏览器打开原订单后付款");
  return api<any>("/payments/create",{method:"POST",auth:true,data:{orderId,channel:channel.toLowerCase(),idempotencyKey:"commerce-payment:"+orderId+":"+channel.toLowerCase()}});
}
export async function confirmPayment(paymentId:string) {
  const payment:any=await api("/payments/"+encodeURIComponent(paymentId),{auth:true});
  return {payment,paid:isPaidStatus(payment.status)};
}
