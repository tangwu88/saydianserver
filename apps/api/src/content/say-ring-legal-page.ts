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
  return `<aside id="ios-activity-sleep-scope" data-product="say-ring" data-platform="ios" data-min-build="1062" data-current-build="1101" data-notice-version="2026-10-17">
<h2>${chinese ? "iOS 活动与睡眠版适用说明" : "Scope of the iOS activity-and-sleep edition"}</h2>
<p>${chinese ? "本说明区分 Say Ring iOS 的实际构建范围，不表示某构建已经通过审核或上架。Android 和此前版本仍按各自实际功能适用下文政策，不表示整个产品不处理健康数据。" : "This notice distinguishes actual Say Ring iOS build scopes; it does not claim review approval or App Store availability. Android and earlier releases remain subject to the policy below according to their actual features; this does not mean the whole product stops processing health data."}</p>
<p data-min-build="1062" data-max-build="1064">${chinese ? "iOS 构建 1062 至 1064 的已发布活动与睡眠版本，可查看和同步的戒指记录限于步数、距离、热量、睡眠阶段与时长；不提供心率、血氧、血压、血糖、心电、心率变异性、体温等生理指标的测量、展示或账号同步功能，不提供自动监测设置、疾病风险评估、设备睡眠评分或 AI 报告，也不触发睡眠 AI 数据上传。" : "The published activity-and-sleep editions, iOS builds 1062 through 1064, display and sync only steps, distance, calories, sleep stages and duration. These builds do not offer measurement, display or account-sync features for physiological readings such as heart rate, blood oxygen, blood pressure, blood glucose, ECG, HRV or temperature. They do not offer automatic-monitoring settings, disease-risk estimates, device sleep scores or AI reports, and do not initiate sleep-AI uploads."}</p>
<p data-min-build="1101">${chinese ? "本次 1.0.2（构建 1101）继续仅展示、同步活动与睡眠数据；不提供手动生理测量、生理数据展示或同步、医疗预警、疾病风险评估、设备睡眠评分或通用 AI 咨询。兼容戒指可按真实能力设置手势模式、固件自动监测开关及监测间隔；设置自动采样不代表 App 提供临床测量或医学准确性承诺。" : "Version 1.0.2 (build 1101) continues to display and sync only activity and sleep records. It does not offer manual physiological measurements, physiological data display/sync, medical alerts, disease-risk estimates, device sleep scores or general AI consultation. Compatible rings can expose actual gesture modes and firmware auto-sampling switches/intervals; configuring sampling is not a clinical measurement or accuracy claim."}</p>
<p>${chinese ? "构建 1101 的账号用户在服务实际可用时，可单独选择睡眠 AI 参考评分及作息建议。生成前须阅读并单独同意当前睡眠分析说明，再明确确认本次睡眠摘要上传。服务端按下文已发布的独立说明向智谱 BigModel（北京智谱华章科技股份有限公司）的 GLM 服务发送选定睡眠摘要，不发送姓名、联系方式、头像、App 账号标识、设备 UUID/MAC 或原始逐段睡眠时间轴。AI 输出可能不准确，属于作息参考，不是设备评分或临床评估。拒绝不影响本机记录查看，游客不上传睡眠数据用于 AI 分析。" : "When the service is available, signed-in build-1101 users may separately choose an AI sleep reference score and routine suggestions. They must read and separately accept the current sleep-analysis notice, then explicitly confirm uploading the selected summary for that request. As explained in the published independent notice below, the service sends the selected sleep summary to Zhipu BigModel (Beijing Zhipu Huazhang Technology Co., Ltd.) GLM, without names, contact details, profile photos, App account identifiers, device UUID/MAC or raw sleep segments. AI output may be inaccurate and is routine reference, not a device or clinical score. Refusing does not affect local records; guest mode does not upload sleep data for this analysis."}</p>
<p>${chinese ? "保留登录、游客本机使用、账号同步、仅限活动与睡眠的远程关爱以及普通设备功能。游客记录留在本机，账号同步及关爱仍须取得相应授权。升级不会删除原有本机或云端记录；未展示的历史生理记录不表示已经删除。Android 和历史版本已有功能及数据继续按各自适用规则处理。下文的处理者 Xuewu Tang、联系邮箱 kf@saydian.com、保存期限及访问、删除、撤回和注销权利不因本说明改变。活动与睡眠记录仅供日常参考；作出任何医疗决定前请咨询医生。" : "Sign-in, guest local use, account sync, authorized activity-and-sleep-only remote care and ordinary device features remain. Guest records stay local; account synchronization and remote care require the corresponding consent. Upgrading does not delete existing local or cloud records; hidden historical physiological readings have not thereby been deleted. Existing Android and earlier-version features and data remain subject to their applicable rules. This notice does not change the controller Xuewu Tang, contact kf@saydian.com, retention periods, or rights of access, deletion, withdrawal and account closure stated below. Activity and sleep records are for everyday reference; consult a doctor before making medical decisions."}</p>
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
${sleepNotice ? `<section id="sleep-analysis" aria-label="可选睡眠 AI 分析单独授权说明"><p class="meta">${document.locale.startsWith("zh") ? "以下独立说明适用于实际提供可选睡眠 AI 的版本，包括本次 iOS 构建 1101；iOS 构建 1062 至 1064 的已发布活动与睡眠版本不提供此功能。是否可用仍取决于实际功能、服务配置与单独授权。" : "The notice below applies to versions that actually offer optional sleep AI, including iOS build 1101. Published activity-and-sleep iOS builds 1062 through 1064 do not offer this feature. Availability still depends on actual features, service configuration and separate consent."}</p>${documentHtml(sleepNotice)}</section>` : ""}
<footer><a href="/say-ring/privacy">隐私政策</a><a href="/say-ring/terms">用户协议</a><a href="mailto:kf@saydian.com">联系我们</a></footer>
</main></body></html>`;
}
