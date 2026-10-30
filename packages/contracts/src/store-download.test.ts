import { describe, expect, it } from "vitest";
import { defaultStoreDownload, parseStoreDownload } from "./store-download";
describe("store download destinations", () => {
  it("provides independent official product pages and limits public fields", () => {
    expect(parseStoreDownload({ token: "never-public" })).toEqual(defaultStoreDownload);
    expect(parseStoreDownload({ title: " 配套 APP " }).title).toBe("配套 APP");
  });
  it.each([
    { cnUrl: "javascript:alert(1)" }, { cnUrl: "https://evil.test/down" },
    { cnUrl: "https://app.saydian.cn@evil.test/down" }, { cnUrl: "http://app.saydian.cn/down" },
    { cnUrl: "https://app.saydian.cn/down2" }, { ringUrl: "https://app.saydian.cn/down" },
    { ringUrl: "https://app.saydian.cn/down2?next=https://evil.test" },
    { cnUrl: "https://user:pass@app.saydian.cn/down" }, { cnUrl: "https://app.saydian.cn/down#x" },
    { internationalUrl: "https://app.saydian.cn/down" }, { iconUrl: "https://evil.test/a.jpg" },
    { title: "" }, { description: "x".repeat(49) }, { title: false },
  ])("rejects unsafe or mismatched destination %j", input => expect(() => parseStoreDownload(input)).toThrow());
  it("accepts official aliases and same-site image URLs", () => {
    expect(parseStoreDownload({ cnUrl: "https://app.saydian.cn/global/down/", ringUrl: "https://app.saydian.cn/say-ring", iconUrl: "https://app.saydian.cn/down/saidian-brand-mark.png" }).ringUrl).toContain("/say-ring");
  });
});
