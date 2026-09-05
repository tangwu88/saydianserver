import type { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "node:crypto";

export async function resolveWorkerSecrets(
  prisma: PrismaClient,
  integrationKey: string,
  environmentMap: Record<string, string>,
): Promise<Record<string, string>> {
  const row = await prisma.integrationSecret.findUnique({
    where: { integrationKey },
  });
  const stored = row ? decryptWorkerSecrets(integrationKey, row) : {};
  const resolved: Record<string, string> = {};
  for (const [key, environmentName] of Object.entries(environmentMap)) {
    const value = String(stored[key] ?? process.env[environmentName] ?? "")
      .replace(/\\n/g, "\n")
      .trim();
    if (value) resolved[key] = value;
  }
  return resolved;
}

export async function markWorkerIntegrationVerified(
  prisma: PrismaClient,
  integrationKey: string,
): Promise<void> {
  try {
    await prisma.integrationConfig.updateMany({
      where: { key: integrationKey },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
  } catch {
    // Status metadata is best effort and must not fail completed provider work.
  }
}

function decryptWorkerSecrets(
  integrationKey: string,
  row: {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: number;
  },
): Record<string, unknown> {
  const key = integrationMasterKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(row.iv, "base64"),
  );
  decipher.setAAD(
    Buffer.from(`saydian-integration:${integrationKey}:v${row.keyVersion}`),
  );
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const value: unknown = JSON.parse(plaintext);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integrationMasterKey() {
  const input = process.env.INTEGRATION_MASTER_KEY?.trim() ?? "";
  const key = /^[0-9a-f]{64}$/i.test(input)
    ? Buffer.from(input, "hex")
    : Buffer.from(input, "base64");
  if (key.length !== 32) {
    throw new Error("Integration master key is unconfigured");
  }
  return key;
}
