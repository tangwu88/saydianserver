import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PrismaService } from "../common/prisma.service";
import { env, envBoolean } from "../common/environment";
import { safeObject, sha256 } from "../common/crypto";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

@Injectable()
export class SupportService {
  private readonly bucket = env("OBJECT_STORAGE_BUCKET", "saydian-app-private");
  private readonly s3 = new S3Client({
    endpoint: env("OBJECT_STORAGE_ENDPOINT", "http://localhost:9000"),
    region: env("OBJECT_STORAGE_REGION", "us-east-1"),
    forcePathStyle: envBoolean("OBJECT_STORAGE_FORCE_PATH_STYLE", true),
    credentials: {
      accessKeyId: env("OBJECT_STORAGE_ACCESS_KEY", "saydian-local"),
      secretAccessKey: env("OBJECT_STORAGE_SECRET_KEY", "local-development-only"),
    },
  });

  constructor(private readonly prisma: PrismaService) {}

  async createFeedback(userId: string, input: unknown) {
    const body = safeObject(input);
    const category = String(body.category ?? "other").trim();
    const content = String(body.content ?? "").trim();
    const contact = String(body.contact ?? "").trim();
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.map(String).slice(0, 6)
      : [];
    if (!content || content.length < 5 || content.length > 2000) {
      throw new BadRequestException("请填写5至2000字的问题说明");
    }
    if (contact.length > 100) throw new BadRequestException("联系方式过长");
    if (attachments.length) {
      const count = await this.prisma.fileObject.count({
        where: { id: { in: attachments }, ownerUserId: userId, status: "ACTIVE" },
      });
      if (count !== attachments.length) throw new BadRequestException("反馈附件不正确");
    }
    const feedback = await this.prisma.feedback.create({
      data: {
        userId,
        category,
        content,
        contact: contact || null,
        attachments: attachments as Prisma.InputJsonValue,
      },
    });
    return { id: feedback.id, status: feedback.status.toLowerCase() };
  }

  async supportConfig() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: "support" } });
    return (
      setting?.value ?? {
        configured: false,
        message: "客服渠道暂时无法使用，请稍后再试",
      }
    );
  }

  async appUpdateConfig() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: "app_update" } });
    if (!setting?.public) throw new NotFoundException("暂未发布更新信息");
    return setting.value;
  }

  async uploadImage(userId: string, file: Express.Multer.File, purposeInput: string) {
    if (!file || !allowedImageTypes.has(file.mimetype)) {
      throw new BadRequestException("请选择 JPG、PNG 或 WebP 图片");
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new BadRequestException("图片大小不能超过10MB");
    }
    const purpose = ["avatar", "feedback", "ecg"].includes(purposeInput)
      ? purposeInput
      : "feedback";
    const digest = sha256(file.buffer);
    const extension =
      file.mimetype === "image/png"
        ? "png"
        : file.mimetype === "image/webp"
          ? "webp"
          : "jpg";
    const objectKey = `${purpose}/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: { sha256: digest, purpose },
        }),
      );
    } catch {
      throw new ServiceUnavailableException("图片暂时无法上传，请稍后再试");
    }
    const stored = await this.prisma.fileObject.create({
      data: {
        ownerUserId: userId,
        objectKey,
        originalName: file.originalname.slice(0, 255),
        contentType: file.mimetype,
        byteSize: file.size,
        sha256: digest,
        purpose,
      },
    });
    const publicBase = env("PUBLIC_BASE_URL", "http://localhost:8080").replace(/\/$/, "");
    return {
      id: stored.id,
      url: `${publicBase}/api/saydian-app/v2/files/${stored.id}`,
      sha256: digest,
      byteSize: file.size,
    };
  }

  async storeLegacyEcgSamples(
    userId: string,
    rawSamples: unknown,
  ): Promise<{
    uploadObjectKey: string;
    sha256: string;
    sampleCount: number;
  }> {
    if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
      throw new BadRequestException("心电波形数据不完整");
    }
    if (rawSamples.length > 1_000_000) {
      throw new BadRequestException("心电波形数据过大，请分段同步");
    }
    const samples = rawSamples.map((value) => Number(value));
    if (samples.some((value) => !Number.isFinite(value))) {
      throw new BadRequestException("心电波形数据格式不正确");
    }
    const compressed = gzipSync(Buffer.from(JSON.stringify(samples)), {
      level: 9,
    });
    if (compressed.byteLength > 25 * 1024 * 1024) {
      throw new BadRequestException("心电波形数据过大，请分段同步");
    }
    const digest = sha256(compressed);
    const objectKey = `ecg/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.json.gz`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: compressed,
          ContentType: "application/gzip",
          Metadata: { sha256: digest, purpose: "ecg" },
        }),
      );
    } catch {
      throw new ServiceUnavailableException("心电数据暂时无法上传，请稍后再试");
    }
    await this.prisma.fileObject.create({
      data: {
        ownerUserId: userId,
        objectKey,
        originalName: "legacy-ecg-samples.json.gz",
        contentType: "application/gzip",
        byteSize: compressed.byteLength,
        sha256: digest,
        purpose: "ecg",
      },
    });
    return {
      uploadObjectKey: objectKey,
      sha256: digest,
      sampleCount: samples.length,
    };
  }

  async uploadEcgArtifact(
    userId: string,
    file: Express.Multer.File,
    expectedSha256Input: string,
  ) {
    const contentTypes = new Set([
      "application/gzip",
      "application/x-gzip",
      "application/octet-stream",
    ]);
    if (!file || !contentTypes.has(file.mimetype)) {
      throw new BadRequestException("请上传 gzip 压缩的心电数据文件");
    }
    if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
      throw new BadRequestException("心电数据文件大小不能超过25MB");
    }
    if (file.buffer[0] !== 0x1f || file.buffer[1] !== 0x8b) {
      throw new BadRequestException("心电数据文件不是有效的 gzip 格式");
    }
    const digest = sha256(file.buffer);
    const expectedSha256 = expectedSha256Input.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || digest !== expectedSha256) {
      throw new BadRequestException("心电数据文件校验失败，请重新上传");
    }
    const objectKey = `ecg/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.bin.gz`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentType: "application/gzip",
          Metadata: { sha256: digest, purpose: "ecg" },
        }),
      );
    } catch {
      throw new ServiceUnavailableException("心电数据暂时无法上传，请稍后再试");
    }
    const stored = await this.prisma.fileObject.create({
      data: {
        ownerUserId: userId,
        objectKey,
        originalName: file.originalname.slice(0, 255),
        contentType: "application/gzip",
        byteSize: file.size,
        sha256: digest,
        purpose: "ecg",
      },
    });
    return {
      id: stored.id,
      uploadObjectKey: stored.objectKey,
      sha256: stored.sha256,
      byteSize: stored.byteSize,
    };
  }

  async publicFile(id: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file || file.status !== "ACTIVE" || file.purpose !== "avatar") {
      throw new NotFoundException("文件不存在");
    }
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: file.objectKey }),
    );
    if (!result.Body) throw new NotFoundException("文件不存在");
    return {
      body: result.Body as NodeJS.ReadableStream,
      contentType: file.contentType,
      byteSize: file.byteSize,
      sha256: file.sha256,
    };
  }
}
