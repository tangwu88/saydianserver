import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { AccountDeletionWorker } from "./account-deletion-worker";
import { OutboxWorker } from "./outbox-worker";
import { pushProviderFromEnvironment } from "./push-provider";

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const prisma = new PrismaClient();
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  const worker = new OutboxWorker(
    prisma,
    redis,
    pushProviderFromEnvironment(),
    new AccountDeletionWorker(prisma),
  );
  const shutdown = () => worker.stop();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await worker.run();
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "worker_stopped",
      message: error instanceof Error ? error.message : "unknown error",
    })}\n`,
  );
  process.exitCode = 1;
});
