import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IntegrationState, Prisma } from "@prisma/client";
import { safeObject } from "../common/crypto";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import type { PrismaService } from "../common/prisma.service";

const settingKey = "say_ring_map";
const integrationKey = "say_ring_amap";

/** Save metadata, encrypted credentials and publication atomically; never trust client configured flags. */
export async function writeSayRingMapSetting(
  prisma: PrismaService,
  secrets: IntegrationSecretsService,
  input: unknown,
) {
  const body = safeObject(input);
  const value = safeObject(body.value);
  if (
    typeof value.enabled !== "boolean" ||
    (body.public !== undefined && typeof body.public !== "boolean")
  ) {
    throw new BadRequestException({
      errorKey: "say_ring_map_invalid",
      message: "地图启用和公开状态必须为开启或关闭",
    });
  }
  if (
    body.webServiceKey !== undefined &&
    typeof body.webServiceKey !== "string"
  ) {
    throw new BadRequestException({
      errorKey: "say_ring_map_key_invalid",
      message: "高德 Web 服务 Key 格式无效，请检查后重试",
    });
  }
  const webServiceKey = String(body.webServiceKey ?? "").trim();
  if (webServiceKey && !/^[A-Za-z0-9]{16,128}$/.test(webServiceKey)) {
    throw new BadRequestException({
      errorKey: "say_ring_map_key_invalid",
      message: "高德 Web 服务 Key 格式无效，请检查后重试",
    });
  }

  try {
    // Encryption must succeed before starting any configuration writes.
    const encrypted = webServiceKey
      ? secrets.prepare(integrationKey, { webServiceKey })
      : undefined;
    return await prisma.$transaction(async (tx) => {
      if (encrypted) {
        // The secret FK requires this parent, including on the first save.
        // This metadata is not proof of a successful provider invocation.
        await tx.integrationConfig.upsert({
          where: { key: integrationKey },
          create: {
            key: integrationKey,
            state: IntegrationState.UNCONFIGURED,
            publicConfig: { provider: "amap" },
          },
          update: {},
        });
        await tx.integrationSecret.upsert({
          where: { integrationKey },
          create: { integrationKey, ...encrypted },
          update: encrypted,
        });
      }
      const stored = await tx.integrationSecret.findUnique({
        where: { integrationKey },
        select: { integrationKey: true },
      });
      if (value.enabled && !stored) {
        throw new BadRequestException({
          errorKey: "say_ring_map_key_required",
          message: "请先填写高德 Web 服务 Key，再启用地图",
        });
      }
      const configuration = {
        provider: "amap",
        enabled: value.enabled,
        configured: Boolean(stored),
      } as Prisma.InputJsonValue;
      return tx.appSetting.upsert({
        where: { key: settingKey },
        create: {
          key: settingKey,
          value: configuration,
          public: body.public === true,
        },
        update: { value: configuration, public: body.public === true },
      });
    });
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    if (error instanceof HttpException && error.getStatus() === 503) {
      throw new ServiceUnavailableException({
        errorKey: "say_ring_map_storage_unavailable",
        message: "地图密钥存储暂时不可用，未更改原配置，请联系管理员",
      });
    }
    // Do not expose SQL, encryption material or provider credentials to the client.
    throw new ServiceUnavailableException({
      errorKey: "say_ring_map_save_failed",
      message: "地图配置保存失败，未更改原配置，请稍后重试",
    });
  }
}
