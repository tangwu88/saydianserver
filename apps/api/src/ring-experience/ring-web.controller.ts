import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { RawResponse } from "../common/raw-response.decorator";

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
  const browserLocale = navigator.language.toLowerCase();
  const en = !/^zh(?:-|$)/.test(browserLocale) || /(?:^|-)(hant|tw|hk|mo)(?:-|$)/.test(browserLocale);
  document.documentElement.lang = en ? 'en' : 'zh-Hans';
  const label = (zh, english) => en ? english : zh;
  const el = (id) => document.getElementById(id);
  const text = (id, value) => { el(id).textContent = value; };
  const mode = document.body.dataset.mode;
  const token = location.hash.slice(1);
  const base = '/global/api/saydian-app/v2/ring/';
  const pages = '/global/say-ring/';
  const titles = {
    sleep: ['睡眠报告','Sleep report'], health: ['健康记录','Health record'],
    workout: ['运动记录','Workout'], week: ['我的这一周','My week']
  };
  const fieldNames = {
    sleepMinutes: ['睡眠时长','Sleep duration','min'], deepMinutes: ['深睡','Deep sleep','min'],
    lightMinutes: ['浅睡','Light sleep','min'], remMinutes: ['快速眼动','REM sleep','min'],
    awakeMinutes: ['清醒时长','Awake time','min'], sleepStart: ['入睡','Fell asleep',''],
    sleepEnd: ['醒来','Woke up',''], sleepScore: ['睡眠评分','Sleep score',''],
    sportName: ['运动','Activity',''], sportMinutes: ['运动时长','Duration','min'],
    distanceKm: ['距离','Distance','km'], steps: ['步数','Steps',''],
    heartRate: ['心率','Heart rate','bpm'], hrv: ['心率变异性','HRV','ms'],
    oxygen: ['血氧','Blood oxygen','%'], temperatureC: ['温度','Temperature','°C'],
    systolic: ['收缩压','Systolic pressure','mmHg'], diastolic: ['舒张压','Diastolic pressure','mmHg'],
    pulse: ['脉搏','Pulse','bpm'], measuredTime: ['测量时间','Reading time',''],
    recordDays: ['有记录天数','Days recorded',''], stress: ['压力','Stress',''],
    bloodGlucose: ['血糖','Blood glucose','mmol/L']
  };
  async function post(path, body) {
    const response = await fetch(base + path, {
      method:'POST', cache:'no-store', credentials:'omit',
      headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body)
    });
    if (!response.ok) { const e = new Error(); e.status = response.status; throw e; }
    return (await response.json()).data;
  }
  function button(title, action) {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = title;
    item.addEventListener('click', () => action(item));
    el('actions').append(item);
  }
  const unavailable = () => text('status', label('链接已失效或暂不可读。', 'This link has expired or is unavailable.'));
  const temporary = () => text('status', label('暂未成功，请重试。', 'Please try again.'));
  function footer() {
    el('footer').hidden = false;
    text('download',label('下载 Say Ring','Get Say Ring'));
  }
  function viewer() {
    const key = 'say-ring-share-visitor';
    try {
      const saved = localStorage.getItem(key);
      if (saved) return saved;
      const fresh = crypto.randomUUID();
      localStorage.setItem(key,fresh);
      return fresh;
    } catch (_) {
      return crypto.randomUUID();
    }
  }
  function renderFields(snapshot) {
    text('title', label(...titles[snapshot.kind]));
    text('day', snapshot.date);
    text('note', snapshot.note);
    const format = new Intl.NumberFormat(en ? 'en' : 'zh-Hans', { maximumFractionDigits: 5 });
    for (const field of snapshot.fields) {
      const meta = fieldNames[field.key];
      if (!meta) continue;
      const group = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label(meta[0],meta[1]);
      dd.textContent = typeof field.value === 'number'
        ? format.format(field.value) + (meta[2] ? ' ' + meta[2] : '')
        : String(field.value);
      group.append(dt,dd);
      el('fields').append(group);
    }
  }
  async function viewShare() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { unavailable(); return; }
    try {
      const result = await post('shares/open', {token});
      renderFields(result.snapshot);
    } catch (_) { unavailable(); return; }
    const visitor = viewer();
    let sent = false;
    for (const [kind, zh, english] of [
      ['cheer','为你开心','Happy for you'],
      ['hug','抱抱你','Sending a hug'],
      ['walk','下次一起走','Let’s walk together'],
    ]) {
      button(label(zh,english), async (item) => {
        if (sent) return;
        sent = true;
        for (const element of el('actions').querySelectorAll('button')) element.disabled = true;
        try {
          await post('shares/respond', {token, visitor, kind});
          text('status', label('已送出你的心意。','Your reaction was sent.'));
        } catch (error) {
          if (error.status === 404) { unavailable(); return; }
          sent = false;
          temporary();
          for (const element of el('actions').querySelectorAll('button')) element.disabled = false;
        }
      });
    }
    const open = el('open');
    open.href = pages + 'respond#' + token;
    open.hidden = false;
    open.textContent = label('在 App 里署名回应','Respond by name in the app');
    footer();
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
    const open = el('open');
    open.href = pages + 'invite#' + token;
    open.hidden = false;
    open.textContent = label('打开 Say Ring','Open Say Ring');
    footer();
  }
  function memberResponse() {
    text('title',label('在 Say Ring 回应好友','Respond in Say Ring'));
    text('note',label('请从原消息打开，或回到分享页直接回应。','Open from the original message, or return to the report to respond in the browser.'));
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
      const open = el('open');
      open.href = pages + 'share#' + token;
      open.hidden = false;
      open.textContent = label('返回分享页','Back to shared report');
    }
    footer();
  }
  text('title',label('Say Ring 分享','Say Ring share'));
  if (mode === 'invite') void invite();
  else if (mode === 'respond') memberResponse();
  else void viewShare();
`;

function html(mode: string, nonce: string) {
  return `<!DOCTYPE html>
<html lang="zh-Hans"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="apple-itunes-app" content="app-id=6816549943">
<meta property="og:title" content="Say Ring">
<meta property="og:description" content="Open a share from Say Ring">
<title>Say Ring</title><style nonce="${nonce}">${css}</style>
</head><body data-mode="${mode}"><main>
<header>Say Ring</header><h1 id="title">Say Ring</h1>
<p id="day"></p><p id="code"></p><p id="note"></p>
<dl id="fields"></dl><div id="actions"></div><p id="status" role="status"></p>
<footer id="footer" hidden><a id="open" hidden></a><a id="download" href="/down2">下载 Say Ring</a></footer>
<noscript>请在浏览器中启用 JavaScript。 Enable JavaScript to view this page.</noscript>
</main><script nonce="${nonce}">${client}</script></body></html>`;
}

@Controller("global/say-ring")
@RawResponse()
export class RingWebController {
  @Get(":mode")
  page(@Param("mode") mode: string, @Res() response: Response) {
    if (!["share", "invite", "respond"].includes(mode)) throw new NotFoundException();
    const nonce = randomBytes(18).toString("base64");
    response.set({
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex,nofollow,noarchive",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    }).type("html").send(html(mode, nonce));
  }
}
