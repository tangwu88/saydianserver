import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IntegrationState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { env } from "../common/environment";
import { isUuid, safeObject } from "../common/crypto";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  async categories(parentId?: string) {
    return this.prisma.articleCategory.findMany({
      where: { enabled: true, parentId: parentId || null },
      orderBy: [{ sort: "desc" }, { name: "asc" }],
    });
  }

  async articles(categoryId?: string, pageInput = 1, pageSizeInput = 20) {
    if (!Number.isSafeInteger(Number(pageInput)) || Number(pageInput) < 1
      || !Number.isSafeInteger(Number(pageSizeInput)) || Number(pageSizeInput) < 1) {
      throw new BadRequestException("分页参数必须为正整数");
    }
    const page = Number(pageInput);
    const pageSize = Math.min(Number(pageSizeInput), 50);
    if (!Number.isSafeInteger((page - 1) * pageSize)) {
      throw new BadRequestException("分页参数超出范围");
    }
    const where = {
      status: "PUBLISHED",
      publishedAt: { lte: new Date() },
      ...(categoryId ? { categoryId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          legacyId: true,
          categoryId: true,
          title: true,
          summary: true,
          coverUrl: true,
          publishedAt: true,
        },
      }),
      this.prisma.article.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async article(id: string) {
    const article = await this.prisma.article.findFirst({
      where: {
        OR: [...(isUuid(id) ? [{ id }] : []), { legacyId: id }],
        status: "PUBLISHED",
        publishedAt: { lte: new Date() },
      },
    });
    if (!article) throw new NotFoundException("文章不存在");
    return article;
  }

  async legalDocument(documentType: string, version?: string) {
    const document = await this.prisma.legalDocument.findFirst({
      where: {
        documentType,
        ...(version ? { version } : { active: true }),
        publishedAt: { lte: new Date() },
      },
      orderBy: { publishedAt: "desc" },
    });
    if (!document) throw new NotFoundException("相关协议暂时无法查看");
    return document;
  }

  async aiHistory(userId: string, clientSessionId?: string) {
    const conversations = await this.prisma.aiConversation.findMany({
      where: { userId, ...(clientSessionId ? { clientSessionId } : {}) },
      include: { messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
      take: clientSessionId ? 1 : 20,
    });
    return conversations;
  }

  async sendAiMessage(userId: string, input: unknown) {
    const body = safeObject(input);
    const content = String(body.content ?? body.message ?? "").trim();
    if (!content || content.length > 4000) throw new BadRequestException("请输入健康问题");
    const aiSettings = await this.aiSettings();
    const clientSessionId = String(body.sessionId ?? body.session_id ?? "").trim();
    const conversation = clientSessionId
      ? await this.prisma.aiConversation.findFirst({
          where: { userId, clientSessionId },
        })
      : null;
    const active =
      conversation ??
      (await this.prisma.aiConversation.create({
        data: {
          userId,
          clientSessionId: clientSessionId || null,
          title: content.slice(0, 40),
        },
      }));
    await this.prisma.aiMessage.create({
      data: { conversationId: active.id, role: "user", content },
    });
    const reply = await this.callAiProvider(content, aiSettings);
    await markIntegrationVerified(this.prisma, "ai");
    const saved = await this.prisma.aiMessage.create({
      data: {
        conversationId: active.id,
        role: "assistant",
        content: reply,
        provider: aiSettings.provider,
      },
    });
    return {
      id: saved.id,
      conversationId: active.id,
      role: saved.role,
      content: saved.content,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  private async callAiProvider(
    content: string,
    settings: { provider: string; baseUrl: string; apiKey: string; model: string },
  ): Promise<string> {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          {
            role: "system",
            content:
              "你是赛电健康管家。只提供一般健康信息和生活方式建议，不作诊断，不承诺治疗效果；遇到急症或明显不适应建议及时就医。",
          },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException("AI健康管家暂时无法使用，请稍后再试");
    }
    const payload = safeObject(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = safeObject(choices[0]);
    const message = safeObject(first.message);
    const reply = String(message.content ?? "").trim();
    if (!reply) throw new ServiceUnavailableException("AI健康管家暂时无法使用，请稍后再试");
    return reply;
  }

  private async aiSettings() {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "ai" },
    });
    const publicConfig = safeObject(integration?.publicConfig);
    const provider = String(
      publicConfig.provider ?? env("AI_PROVIDER", "disabled"),
    ).trim();
    if (integration?.state !== IntegrationState.CONFIGURED || provider === "disabled") {
      throw new ServiceUnavailableException("AI健康管家暂时无法使用，请稍后再试");
    }
    const secrets = await this.integrationSecrets.resolve("ai", {
      apiKey: "AI_API_KEY",
      baseUrl: "AI_BASE_URL",
      model: "AI_MODEL",
    });
    const baseUrl = String(publicConfig.baseUrl ?? secrets.baseUrl ?? "").replace(/\/$/, "");
    const apiKey = secrets.apiKey ?? "";
    const model = String(publicConfig.model ?? secrets.model ?? "configured-model");
    if (!baseUrl || !apiKey) {
      throw new ServiceUnavailableException("AI健康管家暂时无法使用，请稍后再试");
    }
    return { provider, baseUrl, apiKey, model };
  }
}
