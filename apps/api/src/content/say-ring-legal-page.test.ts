import { describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { of, firstValueFrom } from "rxjs";
import { ContentService } from "./content.service";
import { ContentController } from "./content.controller";
import { ApiEnvelopeInterceptor } from "../common/api-envelope.interceptor";
import { renderSayRingLegalPage } from "./say-ring-legal-page";

const row = (documentType: string, contentHtml = "<p>Synthetic published text</p>") => ({
  documentType, title: "Say Ring 合成测试文档", version: "synthetic-ring-v1", locale: "zh-Hans", contentHtml,
  active: true, reviewed: true, publishedAt: new Date("2026-01-01T00:00:00Z"),
});
const terms = row("say_ring_user_agreement");
const privacy = row("say_ring_privacy_policy");
const sleep = { ...row("say_ring_sleep_analysis", "<h2>独立说明</h2><p>仅上传汇总；逐段时间轴留在本机。</p>"), version: "synthetic-sleep-v1" };

function fixture(rows = [terms, privacy, sleep]) {
  const matches = (where: any) => rows.filter(document =>
    (typeof where.documentType === "string" ? document.documentType === where.documentType : where.documentType.in.includes(document.documentType)) &&
    (typeof where.locale === "string" ? document.locale === where.locale : where.locale.in.includes(document.locale)) &&
    document.active && document.reviewed && document.publishedAt <= where.publishedAt.lte &&
    (!where.version || document.version === where.version));
  const findMany = vi.fn(async ({ where }: any) => matches(where));
  const findFirst = vi.fn(async ({ where }: any) => matches(where)[0] ?? null);
  const service = new ContentService({ globalLegalDocument: { findMany, findFirst } } as any, {} as any);
  return { service, findMany, findFirst };
}

describe("current Say Ring public legal pages", () => {
  it.each(["privacy", "terms"])("renders %s directly as HTML using only the current matching product pair", async type => {
    const { service, findMany, findFirst } = fixture();
    const html = await service.sayRingLegalPage(type);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('lang="zh-Hans"');
    expect(html).toContain(`data-document-type="say_ring_${type === "privacy" ? "privacy_policy" : "user_agreement"}"`);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      documentType: { in: ["say_ring_user_agreement", "say_ring_privacy_policy"] }, active: true, reviewed: true,
      publishedAt: { lte: expect.any(Date) },
    }) }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ version: "synthetic-ring-v1", active: true, reviewed: true }) }));
    if (type === "privacy") expect(html).toContain('id="sleep-analysis"');
    else expect(html).not.toContain('id="sleep-analysis"');
  });

  it.each([
    [], [terms], [terms, { ...privacy, version: "old" }],
    [terms, { ...privacy, reviewed: false }], [terms, { ...privacy, active: false }],
    [terms, { ...privacy, publishedAt: new Date("2099-01-01") }],
    [row("user_agreement"), row("privacy_policy")],
  ])("fails closed for missing, unmatched, unpublished or other-product documents", async (...rows) => {
    await expect(fixture(rows).service.sayRingLegalPage("privacy")).rejects.toThrow("No current reviewed Say Ring");
  });

  it("does not serve a retired document when publication changes between reads", async () => {
    const { service, findFirst } = fixture(); findFirst.mockResolvedValueOnce(null);
    await expect(service.sayRingLegalPage("privacy")).rejects.toThrow("document changed");
  });

  it("rejects unknown page types before reading the database", async () => {
    const { service, findMany } = fixture();
    await expect(service.sayRingLegalPage("saydian-global")).rejects.toThrow("not available");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("shows the current independent sleep notice, without recording consent or falling back to Health", async () => {
    const { service, findFirst } = fixture();
    expect(await service.sayRingLegalPage("privacy")).toContain("逐段时间轴留在本机");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ documentType: "say_ring_sleep_analysis", active: true, reviewed: true }) }));
    expect(await fixture([terms, privacy, { ...sleep, reviewed: false }]).service.sayRingLegalPage("privacy")).not.toContain('id="sleep-analysis"');
  });

  it("escapes metadata and strips executable markup, links and third-party resources", () => {
    const html = renderSayRingLegalPage({ ...privacy, title: '<script>alert("title")</script>', version: 'v" onload="bad', contentHtml:
      '<p onclick="bad()">Safe &amp; exact</p><script>alert(1)</script><img src="https://example.invalid/track"><iframe src="https://example.invalid"></iframe><a href="javascript:bad()">bad</a><a href="//example.invalid">relative</a><a href="https://example.invalid/privacy" target="_blank">policy</a><a href="mailto:kf@saydian.com">email</a><style>body{display:none}</style>' });
    expect(html).toContain('<p>Safe &amp; exact</p>');
    expect(html).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;');
    expect(html).toContain('href="https://example.invalid/privacy"');
    expect(html).toContain('href="mailto:kf@saydian.com"');
    expect(html).not.toMatch(/<script|<iframe|<img|onclick=|javascript:|href="\/\/|display:none|target=/);
  });

  it("bypasses the JSON envelope only for the new HTML endpoint", async () => {
    const interceptor = new ApiEnvelopeInterceptor(new Reflector());
    const context = { getHandler: () => ContentController.prototype.sayRingLegalPage, getClass: () => ContentController } as any;
    expect(await firstValueFrom(interceptor.intercept(context, { handle: () => of("<!doctype html>") }))).toBe("<!doctype html>");
    const jsonContext = { getHandler: () => ContentController.prototype.legal, getClass: () => ContentController, switchToHttp: () => ({ getRequest: () => ({ requestId: "synthetic" }) }) } as any;
    expect(await firstValueFrom(interceptor.intercept(jsonContext, { handle: () => of({ version: "synthetic" }) }))).toMatchObject({ code: 200, data: { version: "synthetic" } });
  });
});
