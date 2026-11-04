import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, IntegrationState } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { IntegrationSecretsService } from '../common/integration-secrets.service';
import { safeObject } from '../common/crypto';
import { sleepAiProviderForEndpoint } from '@saydian/app-contracts';
import {
  CYCLE_AI_NOTICE,
  CycleRow,
  dateOnly,
  digest,
  noOverlap,
  object,
  prediction,
  safeAiChoice,
} from './cycle-domain';
import { validateRow } from './cycle-domain';
import { cycleNightSummary } from './cycle-night';
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
@Injectable()
export class CycleService {
  constructor(
    private readonly db: PrismaService,
    private readonly secrets: IntegrationSecretsService,
  ) {}
  // 同一会员的修订和删除共用用户行锁，防止多端并行越过版本检查。
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId}::uuid FOR UPDATE`;
    if (
      (
        await tx.user.findUnique({
          where: { id: userId },
          select: { status: true },
        })
      )?.status !== 'ACTIVE'
    )
      throw new ForbiddenException('请重新登录');
    return tx.cycleState.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }
  private wire(r: {
    clientId: string;
    kind: string;
    data: unknown;
    revision: number;
    deleted: boolean;
  }) {
    return {
      id: r.clientId,
      kind: r.kind,
      data: r.data,
      revision: r.revision,
      deleted: r.deleted,
    };
  }
  private today(offset: unknown) {
    const n = Number(offset ?? 0);
    if (!Number.isInteger(n) || n < -840 || n > 840)
      throw new BadRequestException('时区不正确');
    return new Date(Date.now() + n * 60000).toISOString().slice(0, 10);
  }
  async sync(userId: string, body: unknown) {
    const b = object(body);
    const today = this.today(b.offsetMinutes);
    if (!Array.isArray(b.rows) || b.rows.length > 40)
      throw new BadRequestException('每次最多同步40项');
    const rows = b.rows.map((r) => validateRow(r, today));
    if (
      new Set(rows.map((r) => r.id)).size !== rows.length ||
      new Set(rows.map((r) => r.mutationId)).size !== rows.length
    )
      throw new BadRequestException('重复同步项');
    return this.db.$transaction(async (tx) => {
      let { sequence, epoch } = await this.lock(tx, userId);
      // 删除代次变化后，其他手机的旧离线队列必须先刷新，不能把已删除资料复活。
      if (Number(b.epoch ?? 0) !== epoch)
        throw new ConflictException({
          errorKey: 'cycle_reset',
          message: '周期数据已被删除，请先刷新',
        });
      const results: unknown[] = [];
      for (const row of rows) {
        const inputHash = digest(row);
        // 同一幂等键绑定原载荷：重发只返回原回执，不重复生成修订。
        const replay = await tx.cycleMutation.findUnique({
          where: { userId_mutationId: { userId, mutationId: row.mutationId } },
        });
        if (replay) {
          if (replay.inputHash !== inputHash)
            throw new ConflictException('重复请求内容不一致');
          results.push(replay.result);
          continue;
        }
        const current = await tx.cycleRecord.findUnique({
          where: { userId_clientId: { userId, clientId: row.id } },
        });
        if ((current?.revision ?? 0) !== row.baseRevision) {
          results.push({
            id: row.id,
            conflict: current ? this.wire(current) : null,
          });
          continue;
        }
        const setting =
          row.kind === 'settings'
            ? row.data
            : safeObject(
                (
                  await tx.cycleRecord.findUnique({
                    where: {
                      userId_clientId: { userId, clientId: 'settings' },
                    },
                  })
                )?.data,
              );
        if (
          row.kind !== 'settings' &&
          !row.deleted &&
          (!setting.enabled ||
            !setting.adultConfirmed ||
            !setting.purposeAccepted)
        )
          throw new ForbiddenException('请先开启生理周期并确认数据用途');
        if (current && current.kind !== row.kind)
          throw new ConflictException('记录类型不能变更');
        const revision = (current?.revision ?? 0) + 1;
        const saved = await tx.cycleRecord.upsert({
          where: { userId_clientId: { userId, clientId: row.id } },
          create: {
            userId,
            clientId: row.id,
            kind: row.kind,
            data: row.deleted ? {} : json(row.data),
            revision,
            deleted: row.deleted,
            changeSeq: ++sequence,
          },
          update: {
            data: row.deleted ? {} : json(row.data),
            revision,
            deleted: row.deleted,
            changeSeq: sequence,
          },
        });
        if (
          row.kind === 'settings' &&
          (!row.data.enabled || row.data.recordOnly)
        )
          await tx.consentRecord.updateMany({
            where: { userId, documentType: CYCLE_AI_NOTICE, withdrawnAt: null },
            data: { withdrawnAt: new Date() },
          });
        const result = {
          id: row.id,
          mutationId: row.mutationId,
          row: this.wire(saved),
        };
        await tx.cycleMutation.create({
          data: {
            userId,
            mutationId: row.mutationId,
            inputHash,
            result: json(result),
          },
        });
        results.push(result);
      }
      noOverlap(
        (
          await tx.cycleRecord.findMany({
            where: { userId, kind: 'period', deleted: false },
          })
        ).map((r) => this.wire(r) as CycleRow),
      );
      await tx.cycleState.update({ where: { userId }, data: { sequence } });
      return { results, sequence };
    });
  }
  async changes(userId: string, cursor = 0) {
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new BadRequestException('同步游标不正确');
    return this.db.$transaction(async (tx) => {
      const state = await this.lock(tx, userId);
      if (cursor > state.sequence)
        throw new ConflictException('请重新读取周期记录');
      const rows = await tx.cycleRecord.findMany({
        where: { userId, changeSeq: { gt: cursor } },
        orderBy: { changeSeq: 'asc' },
        take: 200,
      });
      return {
        rows: rows.map((r) => this.wire(r)),
        cursor:
          rows.length === 200
            ? rows[rows.length - 1]!.changeSeq
            : state.sequence,
        hasMore: rows.length === 200,
        epoch: state.epoch,
      };
    });
  }
  async forecast(userId: string, offset: unknown) {
    const today = this.today(offset);
    return this.db.$transaction(async (tx) => {
      const state = await this.lock(tx, userId);
      const rows = (
        await tx.cycleRecord.findMany({ where: { userId, deleted: false } })
      ).map((r) => this.wire(r) as CycleRow);
      const value = { ...prediction(rows, today), generatedOn: today };
      const inputHash = digest({
        sequence: state.sequence,
        today,
        model: 'calendar-v1',
      });
      // 快照只创建，既有结果不会被后来真实日期重写。
      const artifact = await tx.cycleArtifact.upsert({
        where: {
          userId_kind_inputHash: { userId, kind: 'prediction', inputHash },
        },
        create: {
          userId,
          kind: 'prediction',
          inputHash,
          payload: json(value),
          sourceSequence: state.sequence,
        },
        update: {},
      });
      return {
        id: artifact.id,
        prediction: artifact.payload,
        sourceSequence: artifact.sourceSequence,
        createdAt: artifact.createdAt.toISOString(),
      };
    });
  }
  async aiAvailability(userId: string) {
    const [documents, record, integration] = await Promise.all([
      this.db.globalLegalDocument.findMany({
        where: {
          documentType: CYCLE_AI_NOTICE,
          active: true,
          reviewed: true,
          publishedAt: { lte: new Date() },
        },
        orderBy: { publishedAt: 'desc' },
      }),
      this.db.consentRecord.findFirst({
        where: { userId, documentType: CYCLE_AI_NOTICE },
        orderBy: { acceptedAt: 'desc' },
      }),
      this.db.integrationConfig.findUnique({ where: { key: 'ai' } }),
    ]);
    const document = documents.find((d) => d.locale === 'zh-Hans') ?? null;
    const c = safeObject(integration?.publicConfig);
    const providerReady =
      integration?.state === IntegrationState.CONFIGURED &&
      c.cycleAiEnabled === true &&
      c.cycleNoticeVersion === document?.version &&
      Boolean(sleepAiProviderForEndpoint(String(c.baseUrl ?? '')));
    return {
      available: Boolean(document && providerReady),
      granted: Boolean(
        document &&
        record &&
        !record.withdrawnAt &&
        record.version === document.version,
      ),
      version: document?.version ?? null,
      document: document
        ? {
            version: document.version,
            path: `/api/saydian-app/v2/content/legal/${CYCLE_AI_NOTICE}?version=${encodeURIComponent(document.version)}&locale=zh-Hans`,
          }
        : null,
    };
  }
  async consent(userId: string, body: unknown) {
    const b = object(body);
    if (typeof b.granted !== 'boolean')
      throw new BadRequestException('请明确是否同意AI分析');
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, userId);
      if (!b.granted) {
        await tx.consentRecord.updateMany({
          where: { userId, documentType: CYCLE_AI_NOTICE, withdrawnAt: null },
          data: { withdrawnAt: new Date() },
        });
        return;
      }
      const available = await this.aiAvailability(userId);
      const setting = safeObject(
        (
          await tx.cycleRecord.findUnique({
            where: { userId_clientId: { userId, clientId: 'settings' } },
          })
        )?.data,
      );
      if (
        !setting.enabled ||
        !available.available ||
        b.version !== available.version
      )
        throw new ConflictException('周期AI说明或配置已更新，请重新查看');
      await tx.consentRecord.upsert({
        where: {
          userId_documentType_version: {
            userId,
            documentType: CYCLE_AI_NOTICE,
            version: available.version!,
          },
        },
        create: {
          userId,
          documentType: CYCLE_AI_NOTICE,
          version: available.version!,
          acceptedAt: new Date(),
          source: 'say_ring_cycle',
        },
        update: { acceptedAt: new Date(), withdrawnAt: null },
      });
    });
    return this.aiAvailability(userId);
  }
  async nightFeatures(userId: string) {
    const asOf = new Date();
    const records = await this.db.healthRecord.findMany({
      where: {
        userId,
        observedAt: { gte: new Date(+asOf - 180 * 86400000), lte: asOf },
        metric: { in: ['SLEEP', 'TEMPERATURE', 'HEART_RATE', 'HRV'] },
      },
      orderBy: { observedAt: 'desc' },
      take: 100000,
    });
    const value = cycleNightSummary(records, asOf);
    return {
      value,
      inputHash: digest(value.features),
      asOf: asOf.toISOString(),
    };
  }
  async explain(userId: string, offset: unknown) {
    const base = await this.forecast(userId, offset),
      p = safeObject(base.prediction);
    const nightly = await this.nightFeatures(userId);
    const available = await this.aiAvailability(userId);
    let action =
      p.status === 'reference'
        ? 'prepare'
        : p.status === 'needs_confirmation'
          ? 'check_records'
          : 'continue_recording';
    let aiGenerated = false;
    if (available.available && available.granted) {
      const integration = await this.db.integrationConfig.findUnique({
          where: { key: 'ai' },
        }),
        c = safeObject(integration?.publicConfig);
      const secrets = await this.secrets.resolve('ai', {
        apiKey: 'AI_API_KEY',
        model: 'AI_MODEL',
      });
      try {
        // 只传类别与数量，无日期、身份、原始读数/硬件标识；模型只选择已审核的建议动作。
        const response = await fetch(
          String(c.baseUrl).replace(/\/$/, '') + '/chat/completions',
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              authorization: `Bearer ${secrets.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: c.model ?? secrets.model,
              temperature: 0,
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'system',
                  content:
                    'Return JSON with only action: continue_recording, prepare, check_records or keep_wearing. No numbers, dates, diagnoses or free text. prepare only when status is reference.',
                },
                {
                  role: 'user',
                  content: JSON.stringify({
                    status: p.status,
                    completeCycles: Array.isArray(p.lengths)
                      ? p.lengths.length
                      : 0,
                    nightly: nightly.value.summary,
                  }),
                },
              ],
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok) throw new Error('provider_unavailable');
        const data = object(await response.json()),
          choices = data.choices as Array<{ message: { content: string } }>;
        action = safeAiChoice(
          JSON.parse(choices[0]!.message.content),
          p.status === 'reference',
        ).action;
        aiGenerated = true;
      } catch {
        /* 安全模板始终可用；不记录供应商正文或健康载荷。 */
      }
    }
    return this.db.$transaction(async (tx) => {
      const state = await this.lock(tx, userId),
        current = await this.aiAvailability(userId);
      if (
        state.sequence !== base.sourceSequence ||
        (aiGenerated &&
          (!current.available ||
            !current.granted ||
            current.version !== available.version))
      )
        throw new ConflictException('记录或授权已变化，请重新查看');
      const refreshed = await this.nightFeatures(userId);
      if (refreshed.inputHash !== nightly.inputHash)
        throw new ConflictException('戒指记录已更新，请重新分析');
      await tx.cycleArtifact.upsert({
        where: {
          userId_kind_inputHash: {
            userId,
            kind: 'night_features',
            inputHash: nightly.inputHash,
          },
        },
        create: {
          userId,
          kind: 'night_features',
          inputHash: nightly.inputHash,
          sourceSequence: state.sequence,
          payload: json(nightly.value),
        },
        update: {},
      });
      const value = {
        predictionId: base.id,
        prediction: p,
        action,
        aiGenerated,
        sourceSequence: state.sequence,
        noticeVersion: aiGenerated ? available.version : null,
        nightly: nightly.value.summary,
        featureHash: nightly.inputHash,
      };
      const inputHash = digest(value);
      const artifact = await tx.cycleArtifact.upsert({
        where: {
          userId_kind_inputHash: { userId, kind: 'explanation', inputHash },
        },
        create: {
          userId,
          kind: 'explanation',
          inputHash,
          sourceSequence: state.sequence,
          payload: json(value),
        },
        update: {},
      });
      return { id: artifact.id, ...value };
    });
  }
  async erase(userId: string) {
    return this.db.$transaction(async (tx) => {
      let { sequence } = await this.lock(tx, userId);
      const rows = await tx.cycleRecord.findMany({ where: { userId } });
      for (const row of rows)
        await tx.cycleRecord.update({
          where: { userId_clientId: { userId, clientId: row.clientId } },
          data: {
            data: {},
            deleted: true,
            revision: row.revision + 1,
            changeSeq: ++sequence,
          },
        });
      await tx.cycleArtifact.deleteMany({ where: { userId } });
      await tx.cycleMutation.deleteMany({ where: { userId } });
      await tx.consentRecord.updateMany({
        where: { userId, documentType: CYCLE_AI_NOTICE, withdrawnAt: null },
        data: { withdrawnAt: new Date() },
      });
      await tx.cycleState.update({
        where: { userId },
        data: { sequence, epoch: { increment: 1 } },
      });
      return { deleted: true, sequence };
    });
  }
}
