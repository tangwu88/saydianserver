import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { validatePartnerCustomerImage } from "./partner-customer-image";
const file = (buffer: Buffer, mimetype: string) =>
  ({
    buffer,
    size: buffer.length,
    mimetype,
    originalname: "synthetic.jpg",
  }) as Express.Multer.File;
async function jpeg() {
  return sharp({
    create: { width: 12, height: 8, channels: 3, background: "#e2b18c" },
  })
    .jpeg()
    .toBuffer();
}
describe("customer document raster decoding", () => {
  it("accepts JPEGs with 24 trailing chat metadata bytes without changing the original", async () => {
    const original = Buffer.concat([await jpeg(), Buffer.alloc(24, 0x75)]);
    const copy = Buffer.from(original);
    expect(
      await validatePartnerCustomerImage(file(original, "image/jpeg")),
    ).toBe("image/jpeg");
    expect(original).toEqual(copy);
  });
  it.each(["image/jpg", "application/octet-stream", "", "image/png"])(
    "detects JPEG bytes instead of trusting MIME %s",
    async (mime) => {
      expect(await validatePartnerCustomerImage(file(await jpeg(), mime))).toBe(
        "image/jpeg",
      );
    },
  );
  it.each(["png", "webp"] as const)(
    "accepts an intact %s raster",
    async (format) => {
      const buffer = await sharp({
        create: { width: 4, height: 4, channels: 3, background: "white" },
      })
        .toFormat(format)
        .toBuffer();
      expect(
        await validatePartnerCustomerImage(file(buffer, `image/${format}`)),
      ).toBe(`image/${format}`);
    },
  );
  it("rejects a truncated JPEG with a forged end marker", async () => {
    const buffer = await jpeg();
    const corrupt = Buffer.concat([
      buffer.subarray(0, Math.floor(buffer.length * 0.65)),
      Buffer.from([255, 217]),
    ]);
    await expect(
      validatePartnerCustomerImage(file(corrupt, "image/jpeg")),
    ).rejects.toThrow("无法读取");
  });
  it("does not decode SVG or HTML disguised as JPG", async () => {
    for (const text of [
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "<html>synthetic</html>",
    ])
      await expect(
        validatePartnerCustomerImage(file(Buffer.from(text), "image/jpeg")),
      ).rejects.toThrow("无法读取");
  });
});
