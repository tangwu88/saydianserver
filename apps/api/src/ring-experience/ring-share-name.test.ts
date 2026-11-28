import 'reflect-metadata';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/prisma.service';
import { RingExperienceService } from './ring-experience.service';
import { cnRingProduct, ringProduct } from './ring-contract';

const previous = process.env.SAY_RING_SHARING_ENABLED;
beforeEach(() => { process.env.SAY_RING_SHARING_ENABLED = 'true'; });
afterEach(() => { if (previous === undefined) delete process.env.SAY_RING_SHARING_ENABLED; else process.env.SAY_RING_SHARING_ENABLED = previous; });

function fixture() {
  const shareId = randomUUID(), ownerId = randomUUID(), actorId = randomUUID();
  const rows: Array<{ shareId: string; visitor: string; memberId: string | null; name: string | null; kind: string; createdAt: Date }> = [];
  const state = { connected: true, nickname: 'Saydian user' };
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: shareId }]),
    ringShare: { findFirst: vi.fn(async () => ({ id: shareId, ownerId })) },
    careRelationship: { findFirst: vi.fn(async () => state.connected ? { id: randomUUID() } : null) },
    user: { findUnique: vi.fn(async () => ({ nickname: state.nickname })) },
    ringShareReaction: {
      createMany: vi.fn(async ({ data }: { data: typeof rows }) => {
        if (rows.some(row => row.shareId === data[0]!.shareId && row.visitor === data[0]!.visitor)) return { count: 0 };
        rows.push({ ...data[0]!, createdAt: new Date() });
        return { count: 1 };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<typeof rows[number]>; data: { name: string } }) => {
        let count = 0;
        for (const row of rows) {
          if (Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value)) {
            row.name = data.name; count++;
          }
        }
        return { count };
      }),
    },
  };
  const service = new RingExperienceService({ $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService);
  const notify = vi.spyOn(service as any, 'notify').mockResolvedValue(undefined);
  return { service, tx, rows, state, actorId, shareId, notify };
}

for (const product of [ringProduct, cnRingProduct] as const) {
  it(`honours an explicit named retry after an anonymous member response (${product})`, async () => {
    const f = fixture(), token = Buffer.alloc(32, 9).toString('base64url');
    f.state.connected = false;
    await f.service.react({ token, kind: 'cheer', named: false }, f.actorId, product);
    const original = { ...f.rows[0]! };
    f.state.connected = true;
    await Promise.all([1, 2].map(() => f.service.react({ token, kind: 'hug', named: true }, f.actorId, product)));
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toEqual({ ...original, name: 'Saydian user' });
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.tx.ringShare.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ product }),
    }));
    expect(f.tx.ringShareReaction.updateMany).toHaveBeenCalledWith({
      where: { shareId: f.shareId, visitor: original.visitor, memberId: f.actorId, name: null },
      data: { name: 'Saydian user' },
    });
  });
}

it('keeps prior anonymity until a named request passes the current relationship check', async () => {
  const f = fixture(), token = Buffer.alloc(32, 10).toString('base64url');
  await f.service.react({ token, kind: 'cheer', named: false }, f.actorId);
  f.state.connected = false;
  await expect(f.service.react({ token, kind: 'cheer', named: true }, f.actorId)).rejects.toMatchObject({ status: 403 });
  expect(f.rows[0]!.name).toBeNull();
  expect(f.tx.ringShareReaction.updateMany).not.toHaveBeenCalled();
});

it('never upgrades another member or guest response from the current member choice', async () => {
  const f = fixture(), token = Buffer.alloc(32, 11).toString('base64url');
  await f.service.react({ token, kind: 'cheer', named: false }, 'another-member');
  await f.service.react({ token, kind: 'hug', visitor: randomUUID(), named: true });
  await f.service.react({ token, kind: 'cheer', named: false }, f.actorId);
  await f.service.react({ token, kind: 'cheer', named: true }, f.actorId);
  expect(f.rows.map(row => row.name)).toEqual([null, null, 'Saydian user']);
  expect(f.notify).toHaveBeenCalledTimes(3);
});

it('leaves an already named snapshot unchanged on repeated delivery', async () => {
  const f = fixture(), token = Buffer.alloc(32, 12).toString('base64url');
  await f.service.react({ token, kind: 'cheer', named: true }, f.actorId);
  f.state.nickname = 'Later profile name';
  await f.service.react({ token, kind: 'cheer', named: true }, f.actorId);
  expect(f.rows[0]!.name).toBe('Saydian user');
  expect(f.notify).toHaveBeenCalledTimes(1);
});
