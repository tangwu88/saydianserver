import { describe, expect, it } from "vitest";
import { uploadImageBatch } from "./image-batch";

const file = (name: string, type = "image/png", size = 10) => ({ name, type, size }) as File;
describe("batch image uploads", () => {
  it("inserts successful uploads in selection order and continues after a failed image", async () => {
    const inserted: string[] = [], uploaded: string[] = [];
    const result = await uploadImageBatch([file("first"), file("failed"), file("last")], async image => {
      uploaded.push(image.name);
      if (image.name === "failed") throw new Error("网络异常");
      return `https://example.com/${image.name}.png`;
    }, url => { inserted.push(url); });
    expect(uploaded).toEqual(["first", "failed", "last"]);
    expect(inserted).toEqual(["https://example.com/first.png", "https://example.com/last.png"]);
    expect(result).toEqual({ uploaded: 2, failures: ["failed：网络异常"] });
  });
  it("rejects empty, oversized and unsupported images before upload while retaining valid files", async () => {
    const uploaded: string[] = [];
    const result = await uploadImageBatch([file("empty", "image/png", 0), file("large", "image/jpeg", 10 * 1024 * 1024 + 1), file("svg", "image/svg+xml"), file("valid")], async image => {
      uploaded.push(image.name); return "https://example.com/image.png";
    }, () => {});
    expect(uploaded).toEqual(["valid"]);
    expect(result.uploaded).toBe(1);
    expect(result.failures).toHaveLength(3);
  });
});
