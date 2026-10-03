import { describe, expect, it } from "vitest";
import {
  createLegalDocumentDraft,
  legalDocumentEditorFromRow,
  legalDocumentPayload,
  selectLegalDocumentProduct,
  selectLegalDocumentType,
  legalProductForDocumentType,
  legalDocumentTypeLabel,
} from "./legal-document-editor";

describe("product-scoped legal document editor", () => {
  it("assigns sleep analysis only to Say Ring and preserves independent notice publication", () => {
    expect(legalProductForDocumentType("say_ring_sleep_analysis")).toBe(
      "say-ring",
    );
    expect(legalDocumentTypeLabel("say_ring_sleep_analysis")).toBe(
      "Say Ring 睡眠 AI 分析说明",
    );
    const draft = selectLegalDocumentType(
      createLegalDocumentDraft("say-ring", "zh-Hans"),
      "say_ring_sleep_analysis",
    );
    expect(() =>
      selectLegalDocumentType(
        createLegalDocumentDraft("saydian-global"),
        "say_ring_sleep_analysis",
      ),
    ).toThrow();
    expect(() => legalDocumentPayload({ ...draft, active: true })).toThrow(
      "说明内容核对完成后才能启用",
    );
    expect(
      legalDocumentPayload({ ...draft, reviewed: true, active: true })
        .documentType,
    ).toBe("say_ring_sleep_analysis");
  });
  it("starts separate app documents as unpublished drafts with their own document types", () => {
    expect(createLegalDocumentDraft("saydian-global")).toMatchObject({
      legalProduct: "saydian-global",
      documentType: "user_agreement",
      locale: "en",
      active: false,
      reviewed: false,
    });
    expect(createLegalDocumentDraft("say-ring")).toMatchObject({
      legalProduct: "say-ring",
      documentType: "say_ring_user_agreement",
      locale: "en",
      active: false,
      reviewed: false,
    });
  });

  it("opens existing records in the product selected by their stored document type", () => {
    expect(
      legalDocumentEditorFromRow({
        id: "ring-policy",
        documentType: "say_ring_privacy_policy",
        locale: "zh-Hans",
        version: "ring-v1",
        reviewed: true,
        active: false,
      }),
    ).toMatchObject({
      id: "ring-policy",
      legalProduct: "say-ring",
      documentType: "say_ring_privacy_policy",
      locale: "zh-Hans",
      version: "ring-v1",
      reviewed: true,
      active: false,
    });
    expect(
      legalDocumentEditorFromRow({ documentType: "privacy_policy" })
        .legalProduct,
    ).toBe("saydian-global");
  });

  it("clears a draft when its app or document type changes instead of copying policy text across", () => {
    const globalDraft = {
      ...createLegalDocumentDraft("saydian-global", "en"),
      id: "draft-1",
      version: "global-v2",
      title: "Health terms",
      contentHtml: "<p>Health content</p>",
    };
    expect(selectLegalDocumentProduct(globalDraft, "say-ring")).toMatchObject({
      legalProduct: "say-ring",
      documentType: "say_ring_user_agreement",
      locale: "en",
      version: "",
      title: "",
      contentHtml: "",
      active: false,
      reviewed: false,
    });
    expect(
      selectLegalDocumentProduct(globalDraft, "say-ring"),
    ).not.toHaveProperty("id");
    expect(
      selectLegalDocumentType(globalDraft, "privacy_policy"),
    ).toMatchObject({
      legalProduct: "saydian-global",
      documentType: "privacy_policy",
      version: "",
      title: "",
      contentHtml: "",
      active: false,
      reviewed: false,
    });
  });

  it("serializes only the selected app's document fields and requires review before activation", () => {
    const draft = {
      ...createLegalDocumentDraft("say-ring", "zh-Hans"),
      version: "ring-v2",
      title: "Say Ring privacy",
      contentHtml: "<p>Ring-specific content</p>",
      reviewed: true,
      active: true,
    };
    expect(legalDocumentPayload(draft)).toEqual({
      documentType: "say_ring_user_agreement",
      locale: "zh-Hans",
      version: "ring-v2",
      title: "Say Ring privacy",
      contentHtml: "<p>Ring-specific content</p>",
      active: true,
      reviewed: true,
    });
    expect(() =>
      legalDocumentPayload({ ...draft, documentType: "privacy_policy" }),
    ).toThrow("文档类型与所选 App 不匹配");
    expect(() => legalDocumentPayload({ ...draft, reviewed: false })).toThrow(
      "法律审核完成后才能启用协议",
    );
  });

  it("keeps reviewed version content immutable so new wording is stored as a new version", () => {
    const reviewed = legalDocumentEditorFromRow({
      id: "published-ring-policy",
      documentType: "say_ring_privacy_policy",
      locale: "en",
      version: "ring-v1",
      title: "Privacy v1",
      contentHtml: "<p>Original reviewed text</p>",
      reviewed: true,
      active: true,
    });
    expect(legalDocumentPayload(reviewed).active).toBe(true);
    expect(() =>
      legalDocumentPayload({
        ...reviewed,
        contentHtml: "<p>Changed text</p>",
      }),
    ).toThrow("已审核版本不可修改，请新增版本");
  });
});
