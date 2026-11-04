import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
export const CYCLE_AI_NOTICE = 'say_ring_cycle_ai_analysis';
export type CycleRow = {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  revision: number;
  deleted: boolean;
};
export function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('日期不正确');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value)
    throw new BadRequestException('日期不正确');
  return value;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('记录内容不正确');
  return value as Record<string, unknown>;
}
export function validateRow(
  raw: unknown,
  today: string,
): CycleRow & { mutationId: string; baseRevision: number } {
  const b = object(raw),
    d = object(b.data);
  if (
    typeof b.id !== 'string' ||
    !/^[A-Za-z0-9-]{1,80}$/.test(b.id) ||
    typeof b.mutationId !== 'string' ||
    !/^[A-Za-z0-9-]{1,80}$/.test(b.mutationId) ||
    !Number.isSafeInteger(b.baseRevision) ||
    Number(b.baseRevision) < 0 ||
    typeof b.deleted !== 'boolean'
  )
    throw new BadRequestException('修订信息不正确');
  const kind = String(b.kind);
  if (
    !['settings', 'period', 'daily'].includes(kind) ||
    (kind === 'settings' && b.id !== 'settings') ||
    (kind !== 'settings' && b.id === 'settings')
  )
    throw new BadRequestException('记录类型不正确');
  const allowed =
    kind === 'settings'
      ? [
          'enabled',
          'adultConfirmed',
          'purposeAccepted',
          'recordOnly',
          'historyComplete',
          'hideSummary',
          'remind',
          'recordRemind',
          'leadDays',
          'hour',
          'minute',
        ]
      : kind === 'period'
        ? ['start', 'end']
        : ['date', 'flow', 'pain', 'mood', 'fatigue', 'tags'];
  if (
    Object.keys(d).some((k) => !allowed.includes(k)) ||
    JSON.stringify(d).length > 2048
  )
    throw new BadRequestException('记录包含未支持字段');
  if (kind === 'settings') {
    if (b.deleted) throw new BadRequestException('请关闭功能或删除周期数据');
    for (const key of allowed.filter(
      (k) => !['leadDays', 'hour', 'minute'].includes(k),
    ))
      if (typeof d[key] !== 'boolean')
        throw new BadRequestException('请明确周期设置');
    if (d.enabled && (!d.adultConfirmed || !d.purposeAccepted))
      throw new BadRequestException('请先确认成年和数据使用说明');
    for (const [key, max] of [
      ['leadDays', 7],
      ['hour', 23],
      ['minute', 59],
    ] as const)
      if (
        !Number.isInteger(d[key]) ||
        Number(d[key]) < 0 ||
        Number(d[key]) > max
      )
        throw new BadRequestException('提醒时间不正确');
  } else if (!b.deleted) {
    const start = dateOnly(d[kind === 'period' ? 'start' : 'date']);
    if (start > today) throw new BadRequestException('实际记录不能在未来');
    if (
      kind === 'period' &&
      d.end != null &&
      (dateOnly(d.end) < start || String(d.end) > today)
    )
      throw new BadRequestException('请核对结束日期');
    const choices: Record<string, string[]> = {
      flow: ['none', 'light', 'medium', 'heavy'],
      pain: ['none', 'mild', 'moderate', 'severe'],
      mood: ['calm', 'low', 'irritable'],
      fatigue: ['none', 'mild', 'strong'],
    };
    if (kind === 'daily')
      for (const [k, v] of Object.entries(d)) {
        if (k === 'date') continue;
        if (k === 'tags') {
          if (
            !Array.isArray(v) ||
            v.length > 4 ||
            v.some(
              (x) =>
                !['travel', 'unwell', 'medication', 'late_sleep'].includes(x),
            )
          )
            throw new BadRequestException('记录标签不正确');
        } else if (!choices[k]?.includes(String(v)))
          throw new BadRequestException('感受记录不正确');
      }
  }
  return {
    id: b.id,
    kind,
    data: d,
    revision: Number(b.baseRevision),
    baseRevision: Number(b.baseRevision),
    deleted: b.deleted,
    mutationId: b.mutationId,
  };
}
export function noOverlap(rows: CycleRow[]) {
  const p = rows
    .filter((r) => r.kind === 'period' && !r.deleted)
    .sort((a, b) => String(a.data.start).localeCompare(String(b.data.start)));
  for (let i = 1; i < p.length; i++)
    if (String(p[i - 1]!.data.end ?? '9999-12-31') >= String(p[i]!.data.start))
      throw new BadRequestException('经期记录重叠，请核对实际日期');
}
export function prediction(rows: CycleRow[], today: string) {
  const s = rows.find((r) => r.kind === 'settings' && !r.deleted)?.data ?? {};
  const p = rows
    .filter((r) => r.kind === 'period' && !r.deleted)
    .sort((a, b) => String(a.data.start).localeCompare(String(b.data.start)))
    .slice(-7);
  const lengths: number[] = [];
  let status = s.recordOnly ? 'record_only' : 'collecting';
  if (s.enabled && s.historyComplete && !s.recordOnly)
    for (let i = 0; i + 1 < p.length; i++) {
      if (
        !p[i]!.data.end ||
        String(p[i]!.data.end) >= String(p[i + 1]!.data.start)
      )
        return {
          status: 'incomplete',
          modelVersion: 'calendar-v1',
          lengths: [],
          basis: [],
          enhanced: false,
        };
      lengths.push(
        (+new Date(String(p[i + 1]!.data.start)) -
          +new Date(String(p[i]!.data.start))) /
          86400000,
      );
    }
  if (lengths.length < 3)
    return {
      status,
      modelVersion: 'calendar-v1',
      lengths,
      basis: [],
      enhanced: false,
    };
  const last = +new Date(String(p[p.length - 1]!.data.start));
  const from = new Date(last + Math.min(...lengths) * 86400000)
      .toISOString()
      .slice(0, 10),
    to = new Date(last + Math.max(...lengths) * 86400000)
      .toISOString()
      .slice(0, 10);
  status = to < today ? 'needs_confirmation' : 'reference';
  return {
    status,
    from,
    to,
    lengths,
    basis: p.map((r) => `${r.id}:${r.revision}`),
    modelVersion: 'calendar-v1',
    enhanced: false,
  };
}
// 模型参数只能来自独立验证后的版本清单；当前生产清单为空，候选不会影响日期。
export const RELEASED_CYCLE_MODELS: readonly string[] = Object.freeze([]);
export const CYCLE_ACTIONS = [
  'continue_recording',
  'prepare',
  'check_records',
  'keep_wearing',
] as const;
export function safeAiChoice(raw: unknown, hasReference: boolean) {
  const b = object(raw);
  if (
    Object.keys(b).some((k) => k !== 'action') ||
    !CYCLE_ACTIONS.includes(b.action as (typeof CYCLE_ACTIONS)[number]) ||
    (!hasReference && b.action === 'prepare')
  )
    throw new Error('invalid_cycle_ai');
  return { action: b.action as (typeof CYCLE_ACTIONS)[number] };
}
