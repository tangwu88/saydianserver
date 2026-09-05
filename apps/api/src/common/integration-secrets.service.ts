import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { safeObject } from "./crypto";

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

@Injectable()
export class IntegrationSecretsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(integrationKey: string, value: unknown): Promise<void> {
    const secrets = safeObject(value);
    if (!Object.keys(secrets).length) {
      throw new BadRequestException("请填写至少一项密钥配置");
    }
    const serialized = JSON.stringify(secrets);
    if (Buffer.byteLength(serialized) > 64 * 1024) {
      throw new BadRequestException("密钥配置内容过大");
    }
    const encrypted = encryptIntegrationSecrets(
      integrationKey,
      secrets,
      integrationMasterKey(),
    );
    await this.prisma.integrationSecret.upsert({
      where: { integrationKey },
      create: { integrationKey, ...encrypted },
      update: encrypted,
    });
  }

  async read(integrationKey: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.integrationSecret.findUnique({
      where: { integrationKey },
    });
    if (!row) return {};
    try {
      return decryptIntegrationSecrets(integrationKey, row, integrationMasterKey());
    } catch {
      throw new ServiceUnavailableException("集成密钥暂时无法读取，请联系管理员");
    }
  }

  async resolve(
    integrationKey: string,
    environmentMap: Record<string, string>,
  ): Promise<Record<string, string>> {
    const stored = await this.read(integrationKey);
    const resolved: Record<string, string> = {};
    for (const [key, environmentName] of Object.entries(environmentMap)) {
      const value = String(
        stored[key] ?? process.env[environmentName] ?? "",
      )
        .replace(/\\n/g, "\n")
        .trim();
      if (value) resolved[key] = value;
    }
    return resolved;
  }

  async remove(integrationKey: string): Promise<void> {
    await this.prisma.integrationSecret.deleteMany({ where: { integrationKey } });
  }
}

export function encryptIntegrationSecrets(
  integrationKey: string,
  value: Record<string, unknown>,
  key: Buffer,
): EncryptedSecret {
  const iv = randomBytes(12);
  const keyVersion = 1;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`saydian-integration:${integrationKey}:v${keyVersion}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

export function decryptIntegrationSecrets(
  integrationKey: string,
  value: EncryptedSecret,
  key: Buffer,
): Record<string, unknown> {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAAD(
    Buffer.from(`saydian-integration:${integrationKey}:v${value.keyVersion}`),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return safeObject(JSON.parse(plaintext));
}

function integrationMasterKey(): Buffer {
  const input = process.env.INTEGRATION_MASTER_KEY?.trim() ?? "";
  const key = /^[0-9a-f]{64}$/i.test(input)
    ? Buffer.from(input, "hex")
    : Buffer.from(input, "base64");
  if (key.length !== 32) {
    throw new ServiceUnavailableException("集成密钥存储尚未配置");
  }
  return key;
}
