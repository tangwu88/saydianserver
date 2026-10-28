import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

/** Accept a decoded raster, including JPEGs with camera/chat metadata after EOI. */
export async function validatePartnerCustomerImage(
  file: Express.Multer.File | undefined,
) {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.buffer.length < 12 ||
    file.buffer.length > 10 * 1024 * 1024 ||
    file.size !== file.buffer.length
  )
    throw new BadRequestException("图片须为非空文件，且不能超过10MB");
  const b = file.buffer;
  const raster =
    (b[0] === 255 && b[1] === 216 && b[2] === 255) ||
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP");
  if (raster) {
    try {
      const image = sharp(b, {
        limitInputPixels: 40_000_000,
        failOn: "warning",
      }).timeout({ seconds: 8 });
      const metadata = await image.metadata();
      const types: Record<string, string> = {
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      };
      const type = types[String(metadata.format)];
      if (!type || (metadata.pages || 1) > 1)
        throw new Error("Unsupported raster");
      // Header inspection alone cannot prove that the compressed image is intact.
      await image.stats();
      return type;
    } catch {
      /* Return a stable public message, never a decoder diagnostic. */
    }
  }
  throw new BadRequestException(
    "图片无法读取，请选择有效的 JPG、PNG 或 WebP 图片",
  );
}
