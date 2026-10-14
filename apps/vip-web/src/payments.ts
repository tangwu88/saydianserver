export function partnerPaymentChannels(userAgent: string): string[] {
  if (/micromessenger/i.test(userAgent)) return ["wechat_jsapi"];
  return /Android|iPhone|iPad|iPod/i.test(userAgent)
    ? ["wechat_h5", "alipay_wap"]
    : ["wechat_native", "alipay_page"];
}
export function trustedPaymentUrl(raw: unknown): URL {
  const url = new URL(String(raw));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    ![
      "wx.tenpay.com",
      "payapp.weixin.qq.com",
      "mclient.alipay.com",
      "openapi.alipay.com",
      "openapi.alipaydev.com",
      "openapi-sandbox.dl.alipaydev.com",
    ].includes(url.hostname)
  )
    throw new Error("支付跳转地址不受信任");
  return url;
}
export function alipayTransport(invoke: any) {
  const url = trustedPaymentUrl(invoke?.url);
  if (
    invoke?.type !== "FORM" ||
    !/^openapi(?:-sandbox)?\./.test(url.hostname) ||
    url.pathname !== "/gateway.do"
  )
    throw new Error("支付宝支付参数不正确");
  const query = new Set([
    "app_id",
    "method",
    "format",
    "charset",
    "sign_type",
    "sign",
    "timestamp",
    "version",
    "notify_url",
    "return_url",
    "auth_token",
    "app_auth_token",
    "app_cert_sn",
    "alipay_root_cert_sn",
    "ws_service_url",
  ]);
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(invoke.fields || {})) {
    if (typeof value !== "string") throw new Error("支付宝支付参数不正确");
    if (query.has(key)) url.searchParams.set(key, value);
    else fields[key] = value;
  }
  return { url: url.href, fields };
}
export async function invokePartnerPayment(invoke: any): Promise<void> {
  if (invoke?.type === "FORM") {
    const transport = alipayTransport(invoke),
      form = document.createElement("form");
    form.method = "POST";
    form.acceptCharset = "UTF-8";
    form.action = transport.url;
    for (const [name, value] of Object.entries(transport.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    return;
  }
  if (invoke?.type === "REDIRECT") {
    location.assign(trustedPaymentUrl(invoke.url).href);
    return;
  }
  if (invoke?.type === "JSAPI") {
    if (
      !/micromessenger/i.test(navigator.userAgent) ||
      !invoke.appId ||
      !invoke.timeStamp ||
      !invoke.nonceStr ||
      !/^prepay_id=\S+$/.test(String(invoke.package)) ||
      invoke.signType !== "RSA" ||
      !invoke.paySign
    )
      throw new Error("请在微信内打开并重新获取支付信息");
    await new Promise<void>((resolve, reject) => {
      let invoked = false;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("微信支付尚未就绪，请重新点击付款"));
      }, 10000);
      function cleanup() {
        clearTimeout(timeout);
        document.removeEventListener("WeixinJSBridgeReady", start);
      }
      function start() {
        const bridge = (window as any).WeixinJSBridge;
        if (invoked || !bridge?.invoke) return;
        invoked = true;
        cleanup();
        bridge.invoke("getBrandWCPayRequest", invoke, (result: any) =>
          /:ok$/.test(result?.err_msg || "")
            ? resolve()
            : reject(
                new Error(
                  /cancel/.test(result?.err_msg || "")
                    ? "已取消付款，可从充值记录继续"
                    : "微信付款未完成，请查询充值状态",
                ),
              ),
        );
      }
      document.addEventListener("WeixinJSBridgeReady", start);
      start();
    });
    return;
  }
  throw new Error("支付信息待确认，请刷新充值状态");
}
