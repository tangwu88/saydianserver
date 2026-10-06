import sanitizeHtml from "sanitize-html";

type PublishedDocument = {
  documentType: string;
  title: string;
  version: string;
  locale: string;
  contentHtml: string;
};

const escape = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function documentHtml(document: PublishedDocument) {
  const content = sanitizeHtml(document.contentHtml, {
    allowedTags: ["h1", "h2", "h3", "h4", "p", "div", "span", "br", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "blockquote", "a", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: { a: ["href", "title", "rel"] },
    allowedSchemes: ["https", "mailto", "tel"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
  });
  return `<p class="meta">版本：${escape(document.version)} · ${escape(document.locale)}</p>
<article data-document-type="${escape(document.documentType)}" data-version="${escape(document.version)}">${content}</article>`;
}

function versionScopeHtml(locale: string) {
  const chinese = locale.startsWith("zh");
  return `<aside id="ios-activity-sleep-scope" data-product="say-ring" data-platform="ios" data-min-build="1062" data-notice-version="2026-10-07">
<h2>${chinese ? "iOS 活动与睡眠版适用说明" : "Scope of the iOS activity-and-sleep edition"}</h2>
<p>${chinese ? "本说明适用于 Say Ring iOS 构建 1062 起的活动与睡眠版本，不表示该构建已上架。Android 和此前版本仍按各自实际功能适用下文政策；不将本次收敛解释为整个产品不处理健康数据。" : "This notice applies to the activity-and-sleep edition of Say Ring for iOS, starting with build 1062. It does not indicate App Store availability. Android and earlier releases remain covered by the policy below according to their actual features; this change does not mean the whole product stops processing health data."}</p>
<p>${chinese ? "该版本可查看和同步的戒指记录限于步数、距离、热量、睡眠阶段与时长。保留登录、游客本机使用、账号同步、仅限活动与睡眠的远程关爱以及普通设备功能；账号、资料、设备与安全信息仍按下文处理。游客戒指记录留在本机，账号模式可同步本版本支持的记录，关爱仍须取得对应授权。" : "Ring records available for viewing and syncing in this edition are limited to steps, distance, calories, sleep stages and duration. Sign-in, guest local use, account sync, authorized activity-and-sleep-only remote care and ordinary device features remain. Account, profile, device and security information is still processed as described below. Guest ring records stay on the phone; account mode can sync supported records, and remote care still requires the relevant authorization."}</p>
<p>${chinese ? "该版本不提供心率、血氧、血压、血糖、心电、心率变异性、体温等生理指标的测量、展示或账号同步功能，不提供自动健康监测、疾病风险评估、设备睡眠分数或 AI 报告，也不触发睡眠 AI 数据上传。活动与睡眠记录仅供日常参考；作出任何医疗决定前请咨询医生。" : "This edition does not offer measurement, display or account-sync features for physiological readings such as heart rate, blood oxygen, blood pressure, blood glucose, ECG, HRV or temperature. It does not provide automatic health monitoring, disease-risk assessments, device sleep scores or AI reports, and does not initiate sleep-AI data uploads. Activity and sleep records are for everyday reference; consult a doctor before making medical decisions."}</p>
<p>${chinese ? "升级不会删除原有本机或云端记录；此版本未展示的历史生理记录不等于已删除。Android 和历史版本已有功能及数据继续按各自适用规则处理。下文的处理者 Xuewu Tang、联系邮箱 kf@saydian.com、保存期限及访问、删除、撤回和注销权利不因本说明改变。" : "Upgrading does not delete existing local or cloud records. Historical physiological records that are not shown in this edition have not thereby been deleted. Existing Android and earlier-version features and data remain subject to their applicable rules. This notice does not change the controller Xuewu Tang, contact kf@saydian.com, retention periods, or rights of access, deletion, withdrawal and account closure stated below."}</p>
</aside>`;
}

// Read-only rendering: showing a document never accepts or withdraws consent.
export function renderSayRingLegalPage(document: PublishedDocument, sleepNotice?: PublishedDocument | null) {
  return `<!doctype html>
<html lang="${escape(document.locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(document.title)}</title>
<style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#f7f8fb}
body{margin:0}main{box-sizing:border-box;max-width:780px;margin:auto;padding:32px 20px 56px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}p,li{line-height:1.75}.meta{color:#667085}a{color:#2463eb}article{overflow-wrap:anywhere}section,footer{margin-top:32px;border-top:1px solid #dce2ea;padding-top:20px}footer{display:flex;gap:20px;flex-wrap:wrap}
aside{background:#eef4ff;border:1px solid #cfddf5;border-radius:12px;padding:20px;margin:24px 0;overflow-wrap:anywhere}aside h2{margin-top:0}aside p:last-child{margin-bottom:0}
</style></head>
<body><main><h1>${escape(document.title)}</h1>
${versionScopeHtml(document.locale)}
${documentHtml(document)}
${sleepNotice ? `<section id="sleep-analysis" aria-label="可选睡眠 AI 分析单独授权说明"><p class="meta">${document.locale.startsWith("zh") ? "以下独立说明仅适用于实际提供可选睡眠 AI 的 Android 或历史版本；iOS 构建 1062 起的活动与睡眠版不提供此功能。" : "The independent notice below applies only to Android or earlier releases that actually offer optional sleep AI. The iOS activity-and-sleep edition starting with build 1062 does not offer this feature."}</p>${documentHtml(sleepNotice)}</section>` : ""}
<footer><a href="/say-ring/privacy">隐私政策</a><a href="/say-ring/terms">用户协议</a><a href="mailto:kf@saydian.com">联系我们</a></footer>
</main></body></html>`;
}
