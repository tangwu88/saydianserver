import { api } from "./api";
import { isPaidStatus } from "./commerce-model";
export const paymentLabels: Record<string,string> = {wechat_jsapi:"微信支付",wechat_h5:"微信支付",wechat_native:"微信扫码",wechat_mini:"微信支付",alipay_wap:"支付宝",alipay_page:"支付宝"};
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
export async function invokePayment(invoke: any): Promise<{qr?:string;pending?:boolean}> {
  if (!invoke?.type) throw new Error("支付结果待确认，请在订单页刷新，不要重复下单");
  if (invoke.type === "QR") {
    if (!/^data:image\/png;base64,/.test(String(invoke.qrDataUrl))) throw new Error("支付二维码暂时无法显示，请稍后重试");
    return {qr:invoke.qrDataUrl};
  }
  /* #ifdef H5 */
  if (invoke.type === "REDIRECT") { window.location.assign(paymentUrl(invoke.url)); return {pending:true}; }
  if (invoke.type === "FORM") {
    const form = document.createElement("form"); form.method="POST"; form.action=paymentUrl(invoke.url);
    for (const [key,value] of Object.entries(invoke.fields || {})) { const input=document.createElement("input");input.type="hidden";input.name=key;input.value=String(value);form.appendChild(input); }
    document.body.appendChild(form);form.submit();return {pending:true};
  }
  if (invoke.type === "JSAPI") {
    await new Promise<void>((resolve,reject) => {
      const bridge = (window as any).WeixinJSBridge;
      if (!bridge?.invoke) return reject(new Error("微信支付环境尚未就绪，请在微信中重试"));
      bridge.invoke("getBrandWCPayRequest", invoke, (result:any) => /:ok$/.test(result?.err_msg || "") ? resolve() : reject(new Error(/cancel/.test(result?.err_msg || "") ? "已取消支付，可从订单继续" : "微信支付未完成，请查看订单")));
    });
    return {pending:true};
  }
  /* #endif */
  /* #ifdef MP-WEIXIN */
  if (invoke.type === "JSAPI") { await new Promise((resolve,reject)=>uni.requestPayment({...invoke,success:resolve,fail:reject})); return {pending:true}; }
  /* #endif */
  throw new Error("当前环境不支持此支付方式");
}
export async function createOrderPayment(orderId:string,channel:string) {
  return api<any>("/payments/create",{method:"POST",auth:true,data:{orderId,channel:channel.toLowerCase(),idempotencyKey:"commerce-payment:"+orderId+":"+channel.toLowerCase()}});
}
export async function confirmPayment(paymentId:string) {
  const payment:any=await api("/payments/"+encodeURIComponent(paymentId),{auth:true});
  return {payment,paid:isPaidStatus(payment.status)};
}
