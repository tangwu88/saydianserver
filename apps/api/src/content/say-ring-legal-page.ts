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

// Read-only rendering: showing a document never accepts or withdraws consent.
export function renderSayRingLegalPage(document: PublishedDocument, sleepNotice?: PublishedDocument | null) {
  return `<!doctype html>
<html lang="${escape(document.locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(document.title)}</title>
<style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#f7f8fb}
body{margin:0}main{box-sizing:border-box;max-width:780px;margin:auto;padding:32px 20px 56px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}p,li{line-height:1.75}.meta{color:#667085}a{color:#2463eb}article{overflow-wrap:anywhere}section,footer{margin-top:32px;border-top:1px solid #dce2ea;padding-top:20px}footer{display:flex;gap:20px;flex-wrap:wrap}
</style></head>
<body><main><h1>${escape(document.title)}</h1>
${documentHtml(document)}
${sleepNotice ? `<section id="sleep-analysis" aria-label="可选睡眠 AI 分析单独授权说明">${documentHtml(sleepNotice)}</section>` : ""}
<footer><a href="/say-ring/privacy">隐私政策</a><a href="/say-ring/terms">用户协议</a><a href="mailto:kf@saydian.com">联系我们</a></footer>
</main></body></html>`;
}
