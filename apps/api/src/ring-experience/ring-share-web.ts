import { shareFieldNames, shareFieldPriority, shareTitles } from "./ring-share-presentation";

export const shareStyles = `
  body[data-mode="share"] {
    background:radial-gradient(ellipse at top, #fffaf2 0, #f5f0e8 58%, #f1ebe2 100%);
    color:#272e32; min-height:100vh; padding:clamp(16px,5vw,3rem);
  }
  .share-page {
    max-width:36rem; padding:0; background:transparent;
    --ink:#242a34; --muted:#595656; --paper:#fffdf9; --line:#e6ded5;
    --hero:#272747; --hero-end:#474267; --hint:#ebe2ff;
  }
  .share-brand { display:flex; align-items:center; gap:.65rem; margin:0 .2rem 1.15rem; color:var(--ink); letter-spacing:.035em }
  .brand-ring { width:1.35rem; height:1.35rem; border:.18rem solid #465c59; border-radius:50%; box-shadow:inset 0 0 0 .12rem #fffdf9; background:#e5d9c7 }
  .share-report { display:grid; gap:.85rem }
  .share-report[data-kind="health"] { --hero:#173c39; --hero-end:#285752; --hint:#d8f5e8 }
  .share-report[data-kind="workout"] { --hero:#582e29; --hero-end:#794839; --hint:#ffdfc6 }
  .share-report[data-kind="week"] { --hero:#303d33; --hero-end:#4e5942; --hint:#e2efcb }
  .share-hero {
    position:relative; isolation:isolate; overflow:hidden; padding:clamp(20px,5vw,2.25rem);
    border-radius:1.55rem; color:#fff; background:linear-gradient(135deg,var(--hero),var(--hero-end));
    box-shadow:0 .8rem 1.7rem rgba(50,41,47,.16);
  }
  .share-hero::before, .share-hero::after {
    content:""; position:absolute; z-index:-1; pointer-events:none; border-radius:50%;
  }
  .share-hero::before {
    top:-3.1rem; right:-2rem; width:13rem; height:13rem;
    background:radial-gradient(circle at 37% 68%,var(--hint),transparent 65%); opacity:.25;
  }
  .share-hero::after {
    top:-3rem; right:-1.5rem; width:10rem; height:10rem;
    border:1px solid rgba(255,255,255,.25); box-shadow:0 0 0 1.9rem rgba(255,255,255,.055),0 0 0 3.6rem rgba(255,255,255,.04);
  }
  .share-hero p { margin:0; max-width:100% }
  .share-hero #day, .share-from { color:var(--hint); font-size:.94rem }
  .share-hero h1 { margin:.2em 0 .3em; font-size:clamp(1.85rem,6.7vw,2.75rem); line-height:1.16; overflow-wrap:anywhere }
  .share-page dl { margin:0 }
  .share-page #highlight {
    display:block; margin-top:1.25rem; padding-top:1.08rem; border-top:1px solid rgba(255,255,255,.26);
  }
  .share-page #highlight dt { color:var(--hint); font-size:.96rem }
  .share-page #highlight dd {
    margin:.2rem 0 0; font-size:clamp(1.9rem,7.4vw,3.4rem); line-height:1.12; letter-spacing:-.035em;
    font-weight:750; font-variant-numeric:tabular-nums; overflow-wrap:anywhere;
  }
  #highlight-unit { font-size:1rem; font-weight:550; color:var(--hint); letter-spacing:0 }
  .share-stages, .share-reply, .share-state {
    margin:0; border:1px solid var(--line); background:var(--paper); border-radius:1.2rem;
    padding:clamp(16px,4vw,1.45rem);
  }
  .share-note {
    margin-top:1rem; padding:.75rem .9rem; border-radius:.8rem;
    border-inline-start:.2rem solid var(--hint); background:rgba(255,255,255,.12);
  }
  .share-hero .share-note-label { color:var(--hint); font-size:.87rem; margin-bottom:.2rem }
  .share-page #breakdown-title, .share-reply h2 {
    margin:0 0 .6rem; font-size:1.08rem; line-height:1.35; color:var(--ink); overflow-wrap:anywhere;
  }
  .share-note blockquote { margin:0; font-size:1.08rem; line-height:1.55; color:#fff; white-space:pre-wrap; overflow-wrap:anywhere }
  .share-state p:last-of-type, .share-reply p:last-of-type { margin:0 }
  .share-page #fields, .share-page #stages {
    display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,9.5rem),1fr)); gap:.65rem;
  }
  .share-page #fields div { border:1px solid var(--line); background:var(--paper); border-radius:1rem; padding:.82rem .95rem; min-width:0 }
  .share-page #stages div { background:transparent; border-radius:0; padding:.1rem 0; min-width:0 }
  .share-page #fields dt, .share-page #stages dt { color:var(--muted); font-size:.89rem }
  .share-page #fields dd, .share-page #stages dd { color:var(--ink); font-variant-numeric:tabular-nums; font-size:1.16rem }
  .share-page #stage-track { background:#e9e6e4; display:flex; gap:.14rem; overflow:hidden; height:.6rem; border-radius:2rem; margin:.85rem 0 .95rem }
  .share-page .stage-deep { --stage-color:#5a4a9f }
  .share-page .stage-light { --stage-color:#766cb3 }
  .share-page .stage-rem { --stage-color:#8a5379 }
  .share-page .stage-awake { --stage-color:#956238 }
  .share-page #stage-track span { flex-basis:0; background:var(--stage-color); min-width:0; border-radius:1rem }
  .share-page #stages dt::before { content:""; display:inline-block; width:.55rem; height:.55rem; border-radius:50%; background:var(--stage-color); margin-inline-end:.44rem }
  .share-reply { margin-top:.9rem }
  .share-page #actions {
    display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,5.75rem),1fr)); gap:.55rem;
    align-items:stretch;
  }
  .share-page button {
    display:flex; justify-content:center; align-items:center; gap:.35rem; color:#523e42; background:#f8eee8;
    border:1px solid #e7d6cc; border-radius:.85rem; overflow-wrap:anywhere; text-align:center; line-height:1.32;
  }
  .share-page #actions button { min-width:0; flex-direction:column; padding:.65rem .35rem }
  .share-page .reaction-mark { font-size:1.24em; line-height:1; color:#8a4b4a }
  .share-page button[aria-pressed="true"], .share-page button[aria-pressed="true"]:disabled {
    opacity:1; background:#f3ddda; border-color:#a86d68; color:#522b2b;
  }
  .share-page button:focus-visible, .share-page a:focus-visible { outline-color:#805761 }
  .share-page #retry-share { margin-top:.85rem }
  .share-page #status:not(:empty) { margin:.8rem 0 0; color:#524440 }
  .share-page footer {
    align-items:center; justify-content:space-between; gap:.85rem; border-color:var(--line); padding:1rem .15rem 0;
  }
  .share-page footer a { background:#2d504a; border-color:#2d504a; border-radius:.85rem; line-height:1.4 }
  .share-page footer #open { color:#3c4947; background:transparent; border-color:#d1c8bf }
  .share-page #open-help { margin:.55rem .15rem 0; font-size:.85rem; color:var(--muted) }
`;

export const shareLayout = `
<main class="share-page">
  <header class="share-brand"><span class="brand-ring" aria-hidden="true"></span>Say Ring</header>
  <section id="share-state" class="share-state">
    <p id="share-state-text" role="status"></p>
    <button type="button" id="retry-share" hidden></button>
  </section>
  <div id="report" class="share-report" hidden>
    <section class="share-hero" aria-labelledby="title">
      <p class="share-from" id="share-from"></p>
      <h1 id="title"></h1>
      <p id="day"></p>
      <div class="share-note" id="share-note" hidden>
        <p class="share-note-label" id="note-title"></p><blockquote id="note"></blockquote>
      </div>
      <dl id="highlight" hidden><dt id="highlight-label"></dt><dd><span id="highlight-value"></span> <span id="highlight-unit"></span></dd></dl>
    </section>
    <section class="share-stages" id="breakdown" aria-labelledby="breakdown-title" hidden>
      <h2 id="breakdown-title"></h2><div id="stage-track" aria-hidden="true"></div><dl id="stages"></dl>
    </section>
    <dl id="fields" hidden></dl>
  </div>
  <section class="share-reply" id="reply" aria-labelledby="reply-title" hidden>
    <h2 id="reply-title"></h2>
    <div id="actions"></div><p id="status" role="status"></p>
  </section>
  <footer id="footer" hidden>
    <a id="open" hidden></a><a id="download" href="https://app.saydian.cn/down2">下载 Say Ring</a>
  </footer>
  <p id="open-help" hidden></p>
  <noscript>请在浏览器中启用 JavaScript。 Enable JavaScript to view this page.</noscript>
</main>`;

export const shareClient = String.raw`
  const titles = ${JSON.stringify(shareTitles)};
  const fieldNames = ${JSON.stringify(shareFieldNames)};
  const fieldPriority = ${JSON.stringify(shareFieldPriority)};
  const stageKinds = [
    ['deepMinutes','stage-deep'], ['lightMinutes','stage-light'],
    ['remMinutes','stage-rem'], ['awakeMinutes','stage-awake']
  ];
  const shareLocale = en ? 'en' : 'zh-Hans';
  const number = new Intl.NumberFormat(shareLocale, {maximumFractionDigits:5});
  const calendar = new Intl.DateTimeFormat(shareLocale, {
    timeZone:'UTC', year:'numeric', month:'short', day:'numeric'
  });
  const shareLabel = (key) => label(fieldNames[key][0],fieldNames[key][1]);
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object,key);
  function dateForShare(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
  }
  function shareDate(date) {
    const day = dateForShare(date);
    return day && !isNaN(+day) ? calendar.format(day) : date;
  }
  function measureParts(key, value) {
    if (typeof value !== 'number') return [key === 'rangeEnd' ? shareDate(value) : String(value), ''];
    const unit = fieldNames[key][2];
    if (unit === 'min') {
      const hours = Math.floor(value / 60);
      const mins = value % 60;
      if (hours > 0 && mins > 0) {
        return [number.format(hours) + label(' 小时 ',' h ') + number.format(mins),label('分钟','min')];
      }
      if (hours > 0) return [number.format(hours),label('小时','h')];
      return [number.format(value),label('分钟','min')];
    }
    return [number.format(value), unit];
  }
  function addMeasure(list, key, value, style) {
    const group = document.createElement('div');
    if (style) group.className = style;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = shareLabel(key);
    dd.textContent = measureParts(key,value).filter(Boolean).join(' ');
    group.append(dt,dd);
    list.append(group);
  }
  function renderShare({snapshot, sharerName, projectNames}) {
    if (!snapshot || !hasOwn(titles,snapshot.kind) || !Array.isArray(snapshot.fields)) {
      throw new Error('Invalid share');
    }
    const fields = new Map(snapshot.fields
      .filter(field => field && hasOwn(fieldNames,field.key) &&
        (typeof field.value === 'string' || typeof field.value === 'number'))
      .map(field => [field.key,field.value]));
    if (!fields.size) throw new Error('Empty share');

    const included = new Set();
    el('report').dataset.kind = snapshot.kind;
    const name = typeof sharerName === 'string' ? sharerName.trim() : '';
    text('share-from', name
      ? label(name + ' 分享给你','Shared by ' + name)
      : label('好友分享给你','Shared with you'));
    const highlightKey = fieldPriority[snapshot.kind].find((key) => fields.has(key));
    const title = label(...(projectNames || titles[snapshot.kind]));
    if (snapshot.kind === 'workout' && title === fields.get('sportName')) {
      included.add('sportName');
    }
    const note = typeof snapshot.note === 'string' ? snapshot.note.trim() : '';
    text('title',title);
    document.title = [name,title,note,'Say Ring'].filter(Boolean).join(' · ');
    const start = shareDate(snapshot.date);
    const end = fields.get('rangeEnd');
    text('day', typeof end === 'string' && end !== snapshot.date
      ? start + ' – ' + shareDate(end) : start);
    if (end != null) included.add('rangeEnd');

    let highlight;
    if (snapshot.kind === 'health' && fields.has('systolic') && fields.has('diastolic')) {
      highlight = [
        label('血压（收缩压 / 舒张压）','Blood pressure (systolic / diastolic)'),
        number.format(fields.get('systolic')) + ' / ' + number.format(fields.get('diastolic')),
        'mmHg'
      ];
      included.add('systolic');
      included.add('diastolic');
    } else {
      if (highlightKey && !included.has(highlightKey)) {
        highlight = [shareLabel(highlightKey), ...measureParts(highlightKey,fields.get(highlightKey))];
        included.add(highlightKey);
      }
    }
    el('highlight').hidden = !highlight;
    if (highlight) {
      text('highlight-label',highlight[0]);
      text('highlight-value',highlight[1]);
      text('highlight-unit',highlight[2]);
    }

    el('share-note').hidden = !note;
    if (note) {
      text('note-title',label('留言','A note for you'));
      text('note',note);
    }

    const stages = el('stages');
    const track = el('stage-track');
    const found = stageKinds.filter(([key]) => fields.has(key));
    if (found.length > 0) {
      text('breakdown-title',label('睡眠分期','Sleep stages'));
      for (const [key,style] of found) {
        const value = fields.get(key);
        addMeasure(stages,key,value,style);
        included.add(key);
        if (typeof value === 'number' && value > 0) {
          const segment = document.createElement('span');
          segment.className = style;
          segment.style.flexGrow = String(value);
          track.append(segment);
        }
      }
      track.hidden = track.childElementCount === 0;
      el('breakdown').hidden = false;
    }

    const details = el('fields');
    for (const [key,value] of fields) {
      if (!included.has(key)) addMeasure(details,key,value);
    }
    details.hidden = details.childElementCount === 0;
    el('report').hidden = false;
  }
  function viewer() {
    const key = 'say-ring-share-visitor';
    let saved;
    try { saved = localStorage.getItem(key); } catch (_) {}
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(saved || '')) return saved;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
    const fresh = [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
    try { localStorage.setItem(key,fresh); } catch (_) {}
    return fresh;
  }
  function shareState(message, retry) {
    text('share-state-text',message);
    el('share-state').hidden = false;
    el('retry-share').hidden = !retry;
  }
  function expiredShare() {
    document.title = 'Say Ring';
    for (const id of ['report','reply','footer','open-help']) el(id).hidden = true;
    shareState(label('这条分享链接已失效。','This shared link has expired.'),false);
  }
  function allowReactions(visitor) {
    text('reply-title',label('给好友回一句','Send a little love'));
    let sent = false;
    const actions = el('actions');
    for (const [kind, mark, zh, english] of [
      ['cheer','♡','为你开心','Happy for you'],
      ['hug','✦','抱抱你','Sending a hug'],
      ['walk','↗','下次一起走','Let’s walk together'],
    ]) {
      const reaction = button(label(zh,english), async (item) => {
        if (sent) return;
        sent = true;
        for (const element of actions.querySelectorAll('button')) element.disabled = true;
        try {
          await post('shares/respond', {token, visitor, kind});
          item.setAttribute('aria-pressed','true');
          text('status', label('已发到好友的 Say Ring 收件箱。','Sent to your friend’s Say Ring inbox.'));
        } catch (error) {
          if (error.status === 404) { expiredShare(); return; }
          sent = false;
          temporary();
          for (const element of actions.querySelectorAll('button')) element.disabled = false;
        }
      }, mark);
      reaction.setAttribute('aria-pressed','false');
    }
    el('reply').hidden = false;
  }
  async function viewShare() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { expiredShare(); return; }
    shareState(label('正在打开好友的分享…','Opening your friend’s share…'),false);
    try {
      const result = await post('shares/open', {token});
      renderShare(result);
      if (/^[a-f0-9]{64}$/.test(result.titleRef || '')) {
        const address = new URL(location.href);
        if (address.searchParams.get('title') !== result.titleRef) {
          address.searchParams.set('title',result.titleRef);
          try { history.replaceState(null,'',address.href); } catch (_) {}
        }
      }
    } catch (error) {
      if (error.status === 404) expiredShare();
      else shareState(label('暂时打不开这条分享。','This share couldn’t be opened just now.'),true);
      return;
    }
    el('share-state').hidden = true;
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') allowReactions(viewer());
    openApp('respond', label('在 App 里署名回应','Respond by name in the app'));
    footer();
  }
`;
