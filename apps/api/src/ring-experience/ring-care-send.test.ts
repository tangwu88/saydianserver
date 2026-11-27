import 'reflect-metadata';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RingExperienceService } from './ring-experience.service';
import { RingExperienceController } from './ring-experience.controller';
import type { PrismaService } from '../common/prisma.service';

const relationId = '00000000-0000-4000-8000-000000000001';
const messageId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prior = process.env.SAY_RING_CARE_ENABLED;
beforeEach(() => { process.env.SAY_RING_CARE_ENABLED = 'true'; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); if (prior == null) delete process.env.SAY_RING_CARE_ENABLED; else process.env.SAY_RING_CARE_ENABLED = prior; });

function fixture() {
  const rows: any[] = [];
  const notifications: any[] = [];
  const tx: any = {
    $executeRaw: vi.fn(),
    careRelationship: { findFirst: vi.fn(async () => ({ id: relationId, inviterId: 'a', recipientId: 'b', ringSettings: [] })) },
    ringCareMessage: {
      findFirst: vi.fn(async ({ where }: any) => rows.find(r => r.id === where.id && r.authorId === where.authorId && !r.deletedAt)),
      count: vi.fn(async ({ where }: any) => rows.filter(r => r.authorId === where.authorId && +r.createdAt > +where.createdAt.gt).length),
      createMany: vi.fn(async ({ data }: any) => { rows.push({ ...data[0], createdAt: new Date() }); return { count: 1 }; }),
    },
  };
  const service = new RingExperienceService({ $transaction: (fn: any) => fn(tx) } as unknown as PrismaService);
  vi.spyOn(service as any, 'notify').mockImplementation(async (...args: any[]) => { notifications.push(args); });
  return { service, rows, tx, notifications };
}

it('limits only the sender and preserves another member allowance', async () => {
  const { service, tx } = fixture();
  for (let n = 1; n <= 24; n++) await service.send('a', relationId, { messageId: messageId(n), kind: 'thinking' });
  await expect(service.send('a', relationId, { messageId: messageId(25), kind: 'thinking' })).rejects.toMatchObject({ status: 429 });
  await expect(service.send('b', relationId, { messageId: messageId(26), kind: 'thinking' })).resolves.toMatchObject({ id: messageId(26) });
  expect(tx.$executeRaw.mock.calls.some((args: any[]) => args.includes('care-send:a'))).toBe(true);
});

it('retries a committed message even at the limit without duplicate notification', async () => {
  const { service, rows, notifications } = fixture();
  for (let n = 1; n <= 24; n++) await service.send('a', relationId, { messageId: messageId(n), kind: 'thinking' });
  await service.send('a', relationId, { messageId: messageId(1), kind: 'thinking' });
  expect(rows).toHaveLength(24);
  expect(notifications).toHaveLength(24);
  await expect(service.send('a', relationId, { messageId: messageId(1), kind: 'call' })).rejects.toMatchObject({ status: 409 });
});

it('restores allowance after the original minute and counts deleted sends', async () => {
  const { service, rows } = fixture();
  for (let n = 1; n <= 24; n++) await service.send('a', relationId, { messageId: messageId(n), kind: 'thinking' });
  rows[0].deletedAt = new Date();
  await expect(service.send('a', relationId, { messageId: messageId(25), kind: 'thinking' })).rejects.toMatchObject({ status: 429 });
  vi.advanceTimersByTime(60_001);
  await expect(service.send('a', relationId, { messageId: messageId(25), kind: 'thinking' })).resolves.toMatchObject({ id: messageId(25) });
});

it('keeps authentication while excluding only sending from the shared IP bucket', () => {
  expect(Reflect.getMetadata('THROTTLER:SKIPdefault', RingExperienceController.prototype.send)).toBe(true);
  expect(Reflect.getMetadata('__guards__', RingExperienceController.prototype.send)).toHaveLength(1);
  expect(Reflect.getMetadata('THROTTLER:SKIPdefault', RingExperienceController.prototype.thread)).toBeUndefined();
});
