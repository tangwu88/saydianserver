import { Controller, Get, Headers, NotFoundException, Param, Res } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { RawResponse } from "../common/raw-response.decorator";
import { shareClient, shareLayout, shareStyles } from "./ring-share-web";

const css = `
  :root { color-scheme: light; color:#142d2c; background:#eef4f1; font-family:system-ui,sans-serif }
  * { box-sizing:border-box } body { margin:0; padding:clamp(1rem,5vw,3rem) }
  main { width:min(100%,36rem); margin:auto; padding:clamp(1.2rem,5vw,2.7rem); border-radius:1.5rem; background:#fff }
  h1 { font-size:clamp(1.8rem,6vw,2.8rem); margin:.25em 0 .45em; letter-spacing:-.025em }
  p, dd, dt { overflow-wrap:anywhere; line-height:1.55 } #day { color:#47615a }
  dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr)); gap:.7rem }
  dl div { background:#f1f6f3; border-radius:.85rem; padding:.85rem }
  dt { font-size:.9rem; color:#425e54 } dd { font-size:1.22rem; font-weight:650; margin:0 }
  footer { border-top:1px solid #dce8e2; margin-top:1.4rem; padding-top:1.2rem; display:flex; flex-wrap:wrap; gap:.9rem }
  button, footer a { font:inherit; color:#153e32; background:#e5f2e9; border:1px solid #cae4d5; padding:.65rem .9rem; border-radius:.7rem; min-height:44px; cursor:pointer }
  footer a { background:#155b42; color:#fff; text-decoration:none } button:disabled { opacity:.65; cursor:default }
  #actions { display:flex; gap:.55rem; flex-wrap:wrap; align-items:center } #code { font-family:monospace; letter-spacing:.08em }
  header { color:#245c48; font-weight:700 } [hidden] { display:none !important }
  :focus-visible { outline:3px solid #257758; outline-offset:3px }
`;

const client = String.raw`
  const browserLocale = (navigator.language || 'en').toLowerCase();
  const en = !/^zh(?:-|$)/.test(browserLocale) || /(?:^|-)(hant|tw|hk|mo)(?:-|$)/.test(browserLocale);
  document.documentElement.lang = en ? 'en' : 'zh-Hans';
  const label = (zh, english) => en ? english : zh;
  const el = (id) => document.getElementById(id);
  const text = (id, value) => { el(id).textContent = value; };
  const mode = document.body.dataset.mode;
  const token = location.hash.slice(1);
  const base = '/global/api/saydian-app/v2/ring/';
  const pages = '/global/say-ring/';
  const h5Origin = 'https://app.saydian.cn';
  const launchOrigin = document.body.dataset.launchOrigin;
  async function post(path, body) {
    const response = await fetch(base + path, {
      method:'POST', cache:'no-store', credentials:'omit',
      headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body)
    });
    if (!response.ok) { const e = new Error(); e.status = response.status; throw e; }
    return (await response.json()).data;
  }
  function button(title, action, mark) {
    const item = document.createElement('button');
    item.type = 'button';
    if (mark) {
      const icon = document.createElement('span');
      icon.className = 'reaction-mark';
      icon.setAttribute('aria-hidden','true');
      icon.textContent = mark;
      item.append(icon);
    }
    item.append(document.createTextNode(title));
    item.addEventListener('click', () => action(item));
    el('actions').append(item);
    return item;
  }
  const unavailable = () => text('status', label('链接已失效或暂不可读。', 'This link has expired or is unavailable.'));
  const temporary = () => text('status', label('暂未成功，请重试。', 'Please try again.'));
  function footer() {
    el('footer').hidden = false;
    text('download',label('下载 Say Ring','Get Say Ring'));
  }
  function openApp(route, title) {
    const direct = new URL(pages + route + '#' + token, h5Origin);
    const link = el('open');
    if (/Android/i.test(navigator.userAgent) && /Chrome\//i.test(navigator.userAgent)) {
      // A user-initiated, package-scoped Android intent with an HTTPS fallback.
      link.href = 'intent://' + direct.host + direct.pathname + direct.hash +
        '#Intent;scheme=https;package=cn.saydian.ring;S.browser_fallback_url=' +
        encodeURIComponent(direct.href) + ';end';
    } else if (launchOrigin) {
      link.href = new URL(pages + route + '#' + token, launchOrigin).href;
    } else {
      link.href = direct.href;
      el('open-help').hidden = false;
      text('open-help', label('若 App 未打开，可长按链接选择在 Say Ring 打开。','If it stays in the browser, touch and hold the link to open it in Say Ring.'));
    }
    link.hidden = false;
    link.textContent = title;
  }
  async function invite() {
    text('title',label('远程爱邀请','Care invitation'));
    if (!/^[A-HJ-NP-Z2-9]{20}$/.test(token)) { unavailable(); return; }
    try {
      const result = await post('care/invitations/preview', {code:token});
      if (result.inviterName) text('title', label(result.inviterName + '想关心你',result.inviterName + ' wants to check in on you'));
    } catch (_) { unavailable(); return; }
    text('note',label('在 App 接受邀请，可自行选择要分享的健康指标。','Accept in Say Ring and choose which health metrics to share.'));
    const code = token.match(/.{1,5}/g).join(' ');
    text('code',code);
    text('day',label('安装后可再次点击原消息，或输入下方邀请码。','After installing, tap the original message again or enter the invitation code below.'));
    button(label('复制邀请码','Copy invitation code'), async () => {
      try { await navigator.clipboard.writeText(token); text('status',label('已复制。','Copied.')); }
      catch (_) { text('status',label('请选中并复制上方邀请码。','Select and copy the code above.')); }
    });
    if (location.hostname !== 'links.saydian.cn') {
      openApp('invite', label('打开 Say Ring','Open Say Ring'));
    }
    footer();
  }
  function memberResponse() {
    text('title',label('在 Say Ring 回应好友','Respond in Say Ring'));
    text('note',label('请从原消息打开，或回到分享页直接回应。','Open from the original message, or return to the report to respond in the browser.'));
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
      const open = el('open');
      open.href = h5Origin + pages + 'share#' + token;
      open.hidden = false;
      open.textContent = label('返回分享页','Back to shared report');
    }
    footer();
  }
`;

const shareEntry = `${shareClient}
  text('retry-share',label('再试一次','Try again'));
  el('retry-share').addEventListener('click',() => void viewShare());
  void viewShare();
`;

const otherEntry = `
  if (mode === 'invite') void invite();
  else memberResponse();
`;

function html(mode: string, nonce: string, launchOrigin: string) {
  const sharing = mode === "share";
  return `<!DOCTYPE html>
<html lang="zh-Hans"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="apple-itunes-app" content="app-id=6816549943">
<meta property="og:title" content="Say Ring">
<meta property="og:description" content="Open a share from Say Ring">
<title>Say Ring</title><style nonce="${nonce}">${css}${sharing ? shareStyles : ""}</style>
</head><body data-mode="${mode}" data-launch-origin="${launchOrigin}">${sharing ? shareLayout : `<main>
<header>Say Ring</header><h1 id="title">Say Ring</h1>
<p id="day"></p><p id="code"></p><p id="note"></p>
<dl id="fields"></dl><div id="actions"></div><p id="status" role="status"></p>
<footer id="footer" hidden><a id="open" hidden></a><a id="download" href="https://app.saydian.cn/down2">下载 Say Ring</a></footer>
<p id="open-help" hidden></p>
<noscript>请在浏览器中启用 JavaScript。 Enable JavaScript to view this page.</noscript>
</main>`}
<script nonce="${nonce}">${client}${sharing ? shareEntry : otherEntry}</script></body></html>`;
}

@Controller("global/say-ring")
@RawResponse()
export class RingWebController {
  @Get(":mode")
  page(@Param("mode") mode: string, @Headers("host") host: string | undefined, @Res() response: Response) {
    if (!["share", "invite", "respond"].includes(mode)) throw new NotFoundException();
    const nonce = randomBytes(18).toString("base64");
    const launchOrigin = process.env.DEPLOYMENT_SITE !== "us" &&
      process.env.SAY_RING_APP_LINK_HOST_ENABLED === "true" &&
      host === "app.saydian.cn" ? "https://links.saydian.cn" : "";
    response.set({
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex,nofollow,noarchive",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    }).type("html").send(html(mode, nonce, launchOrigin));
  }
}
