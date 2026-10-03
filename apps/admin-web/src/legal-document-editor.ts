export type LegalProduct = "saydian-global" | "say-ring";
export type LegalDocumentEditor = Record<string, unknown> & {
  legalProduct: LegalProduct;
  documentType: string;
  locale: string;
  version: string;
  title: string;
  contentHtml: string;
  active: boolean;
  reviewed: boolean;
};

const documentTypes: Record<LegalProduct, string[]> = {
  "saydian-global": ["user_agreement", "privacy_policy", "health_ai_analysis"],
  "say-ring": [
    "say_ring_user_agreement",
    "say_ring_privacy_policy",
    "say_ring_sleep_analysis",
  ],
};
const ringTypes = new Set(documentTypes["say-ring"]);
const emptyContent = {
  version: "",
  title: "",
  contentHtml: "",
  active: false,
  reviewed: false,
};

export function legalProductForDocumentType(
  documentType: unknown,
): LegalProduct {
  return ringTypes.has(String(documentType)) ? "say-ring" : "saydian-global";
}

export function legalDocumentTypeLabel(documentType: unknown): string {
  return (
    (
      {
        user_agreement: "用户协议",
        privacy_policy: "隐私政策",
        health_ai_analysis: "健康 AI 分析说明",
        say_ring_user_agreement: "Say Ring 用户协议",
        say_ring_privacy_policy: "Say Ring 隐私政策",
        say_ring_sleep_analysis: "Say Ring 睡眠 AI 分析说明",
      } as Record<string, string>
    )[String(documentType)] ?? String(documentType || "—")
  );
}

export function createLegalDocumentDraft(
  product: LegalProduct,
  locale = "en",
): LegalDocumentEditor {
  return {
    legalProduct: product,
    documentType: documentTypes[product][0]!,
    locale,
    ...emptyContent,
  };
}

export function legalDocumentEditorFromRow(
  row: Record<string, unknown>,
): LegalDocumentEditor {
  const editor = {
    ...row,
    legalProduct: legalProductForDocumentType(row.documentType),
    documentType: String(row.documentType ?? "user_agreement"),
    locale: String(row.locale ?? "en"),
    version: String(row.version ?? ""),
    title: String(row.title ?? ""),
    contentHtml: String(row.contentHtml ?? ""),
    active: row.active === true,
    reviewed: row.reviewed === true,
  } as LegalDocumentEditor;
  if (editor.reviewed) editor._reviewedSnapshot = snapshot(editor);
  return editor;
}

export function selectLegalDocumentProduct(
  editor: LegalDocumentEditor,
  product: LegalProduct,
): LegalDocumentEditor {
  if (editor.legalProduct === product) return editor;
  return { ...createLegalDocumentDraft(product, editor.locale) };
}

export function selectLegalDocumentType(
  editor: LegalDocumentEditor,
  documentType: string,
): LegalDocumentEditor {
  if (!documentTypes[editor.legalProduct].includes(documentType)) {
    throw new Error("文档类型与所选 App 不匹配");
  }
  if (editor.documentType === documentType) return editor;
  return {
    ...editor,
    ...emptyContent,
    id: undefined,
    _reviewedSnapshot: undefined,
    documentType,
  };
}

export function legalDocumentPayload(
  editor: LegalDocumentEditor,
): Record<string, unknown> {
  if (!documentTypes[editor.legalProduct].includes(editor.documentType)) {
    throw new Error("文档类型与所选 App 不匹配");
  }
  if (editor.active && !editor.reviewed)
    throw new Error(
      editor.documentType === "say_ring_sleep_analysis"
        ? "说明内容核对完成后才能启用"
        : "法律审核完成后才能启用协议",
    );
  if (
    editor.reviewed &&
    editor._reviewedSnapshot &&
    JSON.stringify(snapshot(editor)) !==
      JSON.stringify(editor._reviewedSnapshot)
  ) {
    throw new Error("已审核版本不可修改，请新增版本");
  }
  return {
    documentType: editor.documentType,
    locale: editor.locale,
    version: editor.version,
    title: editor.title,
    contentHtml: editor.contentHtml,
    active: editor.active,
    reviewed: editor.reviewed,
  };
}

function snapshot(editor: LegalDocumentEditor): Record<string, unknown> {
  return Object.fromEntries(
    ["documentType", "locale", "version", "title", "contentHtml"].map((key) => [
      key,
      editor[key],
    ]),
  );
}
