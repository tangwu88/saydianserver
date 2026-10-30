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
</aside>
<aside id="ios-read-only-health-scope" data-product="say-ring" data-platform="ios" data-min-build="1110" data-notice-version="2026-10-18">
<h2>${chinese ? "iOS 构建 1110 起的只读健康记录说明" : "Read-only health records from iOS build 1110"}</h2>
<p>${chinese ? "对于 iOS 构建 1110 起的兼容版本，下述范围取代上方旧构建的生理数据展示限制；这不是已通过苹果审核或已上架的声明。在兼容设备确有真实记录、且对应只读开关启用时，App 可读取并展示心率、心率变异性（HRV）、血氧、皮肤温度及压力记录、历史和趋势。未启用、不可用或未知的记录不会补零或生成虚构数值。" : "For compatible iOS builds from 1110, this scope replaces the physiological-display restrictions described above for older builds. This is not a claim of Apple review approval or store availability. When a compatible device provides real records and the corresponding read-only setting is enabled, the App may read and display heart rate, HRV, blood oxygen, skin temperature and stress records, history and trends. Disabled, unavailable or unknown readings are not replaced with zeroes or invented values."}</p>
<p>${chinese ? "新增生理记录保存在本机；本轮不新增生理数据账号云上传，也不上传原始测量分段。登录用户可在既有账号权限和对应开关范围内读取其云端已有记录；游客不读取账号云记录。原有活动与睡眠同步、远程关爱授权及可选睡眠 AI 的独立说明和授权要求不变。" : "New physiological records stay on the device. This release does not add physiological account-cloud uploads or uploads of raw measurement segments. Signed-in users may read existing records belonging to their account within its permissions and the enabled settings; guests do not read account-cloud records. Existing activity/sleep sync, remote-care consent and separate notices and consent requirements for optional sleep AI remain unchanged."}</p>
<p>${chinese ? "这些开关仅控制只读记录展示，对所有用户采用同一规则；不会开启手动生理测量、血压、血糖、心电、身体成分、疾病风险评估、医疗预警或通用 AI。上述记录及趋势仅供日常健康参考，不用于诊断或治疗，也不承诺医学准确性；作出医疗决定前请咨询医生。下文处理者、联系方式、保存期限和访问、删除、撤回及注销权利不变。" : "These switches control read-only records under the same rules for all users. They do not enable manual physiological measurements, blood pressure, blood glucose, ECG, body composition, disease-risk estimates, medical alerts or general AI. Records and trends are everyday wellness references, not diagnosis or treatment or a promise of medical accuracy; consult a doctor before medical decisions. The controller, contact details, retention and access, deletion, withdrawal and account-closure rights below are unchanged."}</p>
</aside>
<aside id="ios-personal-reminder-scope" data-product="say-ring" data-platform="ios" data-min-build="1181" data-notice-version="2026-10-30">
<h2>${chinese ? "iOS 构建 1181 起的手动测量与个人提醒说明" : "Manual readings and personal reminders from iOS build 1181"}</h2>
<p>${chinese ? "本段适用于实际提供下述功能的兼容 iOS 构建，取代上方旧构建中不同的手动测量和个人提醒范围；不表示已通过审核或已经上架。各项功能仍取决于戒指真实能力、公开服务配置、用户选择及系统权限，不按账号或审核设备另行开放。" : "This notice applies to compatible iOS builds that actually provide these features, replacing differing manual-reading and personal-reminder limits stated above for older builds. It does not claim review approval or store availability. Features still depend on real ring capabilities, public service configuration, user choices and system permissions, with no account-specific or reviewer-only access."}</p>
<p>${chinese ? "在设备确实支持、相应只读权限有效且独立手动测量权限已获原生确认时，用户可主动发起心率、心率变异性（HRV）、血氧或皮肤温度测量。仅被动提供温度历史的设备不会因此获得手动温度功能。不支持或未提供的项目不显示，未知值不补造。" : "When the ring actually supports it, the corresponding read permission is valid and the separate manual-measurement permission has native acknowledgement, users may initiate heart-rate, HRV, blood-oxygen or skin-temperature measurements. A device that only provides passive temperature history does not thereby gain manual temperature support. Unsupported or unavailable features stay hidden, and unknown readings are not invented."}</p>
<p>${chinese ? "个人提醒默认关闭，由用户设置并开启心率高低、血氧偏低、HRV 恢复参考或皮温偏高比较。HRV 与皮温需要为同一戒指和固件明确设置个人参考及变化幅度；更换目标不复用参考。仅比较新完成、来源与质量有效的本次测量；历史回补、缓存、预览和未知值不生成真实提醒。HRV 仅供恢复与疲劳变化参考，不是疲劳诊断；皮温不等于核心体温，不能套用体温计发热界限，请用体温计确认体温。" : "Personal reminders start off and require the user to configure and enable high/low heart-rate, low-oxygen, HRV recovery-reference or higher-skin-temperature comparisons. HRV and skin temperature require an explicitly configured personal reference and change limit for the same ring and firmware; references are not reused for a replacement target. Only a newly completed reading with valid source and quality is compared. Historical imports, cached values, previews and unknown values create no real reminder. HRV is a recovery and fatigue-change reference, not a fatigue diagnosis. Skin temperature is not core temperature or a thermometer fever cutoff; confirm body temperature with a thermometer."}</p>
<p>${chinese ? "个人参考、提醒设置和本机提醒记录保存在账号隔离的本机加密存储。真实提醒可显示可关闭的动画、短提示音和去重的本机消息；经系统允许后可显示不含具体健康数值的系统通知，支持的戒指可按用户选择发出一次振动。声音遵循系统静音和音量。用户主动打开的效果预览可播放提示音及受支持戒指的一次振动，但不生成健康记录、本机消息或系统通知。" : "Personal references, reminder preferences and local reminder records use account-isolated encrypted storage on the phone. A real reminder may show dismissible animation, a short tone and a deduplicated local inbox message. With system permission it may show a generic notification without health values; a supported ring may deliver one user-enabled vibration. Sound follows system silent and volume settings. A user-opened preview may play the tone and one supported ring vibration but creates no health record, inbox message or system notification."}</p>
<p>${chinese ? "上述功能不提供连续或后台监护，不诊断、预测或排除疾病，不会自动拨打急救电话或通知他人；没有提醒不表示没有风险。出现严重不适时请及时寻求医疗帮助，不要等待戒指再次测量。本版不新增 iOS 生理数据云上传或第三方健康数据传输；原有活动与睡眠同步、关爱授权和可选睡眠 AI 的独立说明及逐次授权要求保持。下文已发布协议正文、同意版本、处理者、联系方式、保存期限及访问、撤回、删除和注销权利不因本段说明而改变。" : "These features do not provide continuous or background monitoring, diagnose, predict or exclude disease, automatically call emergency services or contact others. No reminder does not mean no risk. Seek medical help for serious symptoms rather than waiting for another ring reading. This release adds no iOS physiological cloud upload or third-party health-data transfer. Existing activity/sleep sync, care permissions and the independent notice and per-request consent for optional sleep AI remain. This scope notice does not change the published agreement text, consent version, controller, contact details, retention or access, withdrawal, deletion and account-closure rights below."}</p>
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
