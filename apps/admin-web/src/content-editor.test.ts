import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("administrator online content editor", () => {
  it("uploads cover and inline images through the authenticated same-origin endpoint", () => {
    const rich = readFileSync(new URL("./components/RichTextEditor.vue", import.meta.url), "utf8");
    const cover = readFileSync(new URL("./components/ContentImageField.vue", import.meta.url), "utf8");
    for (const source of [rich, cover]) {
      expect(source).toContain('api.post("/content-images", body)');
      expect(source).not.toContain('"content-type": "multipart/form-data"');
      expect(source).toContain("image/jpeg,image/png,image/webp");
      expect(source).toContain("10 * 1024 * 1024");
    }
  });

  it("keeps inline images in the allowlist but strips unsafe attributes and sources", () => {
    const source = readFileSync(new URL("./components/RichTextEditor.vue", import.meta.url), "utf8");
    expect(source).toContain('"IMG"');
    expect(source).toContain("normalizeImage");
    expect(source).toContain("element.removeAttribute(attribute.name)");
    expect(source).toContain('element.setAttribute("loading", "lazy")');
    expect(source).toContain('url.protocol === "https:"');
    expect(source).toContain('["localhost", "127.0.0.1", "[::1]"]');
    expect(source).toContain("上传图片");
  });
});
