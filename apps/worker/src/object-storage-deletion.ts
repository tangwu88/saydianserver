import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  resolveWorkerSecrets,
  markWorkerIntegrationVerified,
} from "./integration-secrets";

type ObjectStorageClient = Pick<S3Client, "send">;

export class ObjectStorageDeletion {
  constructor(private readonly prisma: PrismaClient) {}

  async delete(objectKeys: string[]): Promise<void> {
    const keys = [...new Set(objectKeys.filter(Boolean))];
    if (!keys.length) return;
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "object_storage" },
      select: { publicConfig: true },
    });
    const publicConfig = objectValue(integration?.publicConfig);
    const secrets = await resolveWorkerSecrets(this.prisma, "object_storage", {
      endpoint: "OBJECT_STORAGE_ENDPOINT",
      bucket: "OBJECT_STORAGE_BUCKET",
      region: "OBJECT_STORAGE_REGION",
      accessKeyId: "OBJECT_STORAGE_ACCESS_KEY",
      secretAccessKey: "OBJECT_STORAGE_SECRET_KEY",
      forcePathStyle: "OBJECT_STORAGE_FORCE_PATH_STYLE",
    });
    const endpoint = String(
      publicConfig.endpoint ?? secrets.endpoint ?? "",
    ).trim();
    const bucket = String(publicConfig.bucket ?? secrets.bucket ?? "").trim();
    const region = String(
      publicConfig.region ?? secrets.region ?? "us-east-1",
    ).trim();
    const accessKeyId = secrets.accessKeyId ?? "";
    const secretAccessKey = secrets.secretAccessKey ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("Object storage deletion is unconfigured");
    }
    const configuredForcePathStyle =
      publicConfig.forcePathStyle ?? secrets.forcePathStyle;
    const forcePathStyle =
      configuredForcePathStyle === true ||
      ["1", "true", "yes"].includes(
        String(configuredForcePathStyle ?? "").toLowerCase(),
      );
    const client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
    await deleteObjectKeys(client, bucket, keys);
    await markWorkerIntegrationVerified(this.prisma, "object_storage");
  }
}

export async function deleteObjectKeys(
  client: ObjectStorageClient,
  bucket: string,
  objectKeys: string[],
): Promise<void> {
  for (let offset = 0; offset < objectKeys.length; offset += 1000) {
    const keys = objectKeys.slice(offset, offset + 1000);
    const command = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      });
    // S3-compatible stores can require MD5 even when the SDK adds CRC32.
    // Hash the serialized XML before signing, rather than reconstructing it.
    command.middlewareStack.add((next) => async (args) => {
      const request = args.request as { body?: string | Uint8Array; headers: Record<string, string> };
      if (typeof request.body !== "string" && !(request.body instanceof Uint8Array)) {
        throw new Error("Object deletion request body is not buffered");
      }
      request.headers["content-md5"] = createHash("md5").update(request.body).digest("base64");
      return next(args);
    }, { step: "build", name: "deleteObjectsContentMd5", priority: "high" });
    const result = await client.send(command);
    if (result.Errors?.length) {
      throw new Error(
        `Object storage rejected ${result.Errors.length} deletion(s)`,
      );
    }
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
