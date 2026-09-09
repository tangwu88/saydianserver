import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { IntegrationState, Prisma } from "@prisma/client";
import { parseDownloadManifest } from "@saydian/app-contracts";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PrismaService } from "../common/prisma.service";
import { env } from "../common/environment";
import { safeObject, sha256 } from "../common/crypto";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

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
    // Read only the explicitly published support record; do not load private JSON.
    const setting = await this.prisma.appSetting.findFirst({
      where: { key: "support", public: true },
      select: { value: true },
    });
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
    try {
      return parseDownloadManifest(setting.value);
    } catch {
      throw new ServiceUnavailableException("下载信息暂时不可用");
    }
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
    const storage = await this.storage();
    try {
      await storage.s3.send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: { sha256: digest, purpose },
        }),
      );
      await markIntegrationVerified(this.prisma, "object_storage");
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
    const storage = await this.storage();
    try {
      await storage.s3.send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: objectKey,
          Body: compressed,
          ContentType: "application/gzip",
          Metadata: { sha256: digest, purpose: "ecg" },
        }),
      );
      await markIntegrationVerified(this.prisma, "object_storage");
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
    const storage = await this.storage();
    try {
      await storage.s3.send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentType: "application/gzip",
          Metadata: { sha256: digest, purpose: "ecg" },
        }),
      );
      await markIntegrationVerified(this.prisma, "object_storage");
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
    const storage = await this.storage();
    const result = await storage.s3.send(
      new GetObjectCommand({ Bucket: storage.bucket, Key: file.objectKey }),
    );
    await markIntegrationVerified(this.prisma, "object_storage");
    if (!result.Body) throw new NotFoundException("文件不存在");
    return {
      body: result.Body as NodeJS.ReadableStream,
      contentType: file.contentType,
      byteSize: file.byteSize,
      sha256: file.sha256,
    };
  }

  private async storage() {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "object_storage" },
    });
    if (!integration || integration.state !== IntegrationState.CONFIGURED) {
      throw new ServiceUnavailableException("文件服务暂时无法使用，请稍后再试");
    }
    const publicConfig = safeObject(integration.publicConfig);
    const secrets = await this.integrationSecrets.resolve("object_storage", {
      endpoint: "OBJECT_STORAGE_ENDPOINT",
      bucket: "OBJECT_STORAGE_BUCKET",
      region: "OBJECT_STORAGE_REGION",
      accessKeyId: "OBJECT_STORAGE_ACCESS_KEY",
      secretAccessKey: "OBJECT_STORAGE_SECRET_KEY",
      forcePathStyle: "OBJECT_STORAGE_FORCE_PATH_STYLE",
    });
    const endpoint = String(publicConfig.endpoint ?? secrets.endpoint ?? "").trim();
    const bucket = String(publicConfig.bucket ?? secrets.bucket ?? "").trim();
    const region = String(publicConfig.region ?? secrets.region ?? "us-east-1").trim();
    const accessKeyId = secrets.accessKeyId ?? "";
    const secretAccessKey = secrets.secretAccessKey ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException("文件服务暂时无法使用，请稍后再试");
    }
    const configuredForcePathStyle = publicConfig.forcePathStyle ?? secrets.forcePathStyle;
    const forcePathStyle =
      configuredForcePathStyle === true ||
      ["1", "true", "yes"].includes(String(configuredForcePathStyle ?? "").toLowerCase());
    return {
      bucket,
      s3: new S3Client({
        endpoint,
        region,
        forcePathStyle,
        credentials: { accessKeyId, secretAccessKey },
      }),
    };
  }
}
