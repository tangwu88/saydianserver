import { it, expect } from 'vitest';
import { cycleNightSummary, CycleSensorRow } from './cycle-night';
it('requires actual sleep window, source, coverage and known temperature semantics; deduplicates', () => {
  const start = new Date('2026-10-02T00:00:00Z'),
    end = new Date('2026-10-02T04:00:00Z');
  const base = {
    sourceDeviceKey: 'owner-scoped-device',
    sourceModel: 'test',
    sourceFirmware: '1',
    sourceOrigin: 'watch_history',
    quality: 'UNKNOWN',
  };
  const sleep: CycleSensorRow = {
    ...base,
    metric: 'SLEEP',
    clientRecordId: 'sleep',
    values: { value: 4 },
    observedAt: end,
    sourceMetadata: {
      sleepWindows: [
        {
          kind: 'night',
          date: '2026-10-02',
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        },
      ],
    },
  };
  const sensors: CycleSensorRow[] = Array.from({ length: 48 }, (_, i) => ({
    ...base,
    metric: 'TEMPERATURE',
    clientRecordId: `t${i}`,
    values: { value: 32.5 },
    observedAt: new Date(+start + i * 300000),
    sourceMetadata: {
      vendor: 'test',
      provenance: {
        timeBasis: 'sdk',
        temperatureKind: 'skin',
        intervalSeconds: 300,
      },
    },
  }));
  const result = cycleNightSummary(
    [sleep, ...sensors, sensors[0]!],
    new Date('2026-10-03'),
  );
  expect(result.summary.usableNights).toBe(1);
  expect(result.features[0]).toMatchObject({
    sampleCount: 48,
    median: 32.5,
    enhancementEligible: false,
  });
  expect(cycleNightSummary(sensors, new Date('2026-10-03')).features).toEqual(
    [],
  );
  expect(
    cycleNightSummary([sleep, ...sensors.slice(0, 8)], new Date('2026-10-03'))
      .features,
  ).toEqual([]);
});
