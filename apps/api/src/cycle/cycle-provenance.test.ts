import { it, expect } from 'vitest';
import { validateHealthRecord } from '../health/health-validation';
it('accepts original qring/coolwear source metadata including normal r/n characters', () => {
  for (const vendor of ['qring', 'coolwear']) {
    const input = {
      id: 'synthetic-source',
      metric: 'temperature',
      observedAt: '2026-10-01T01:00:00Z',
      timezoneOffsetMinutes: 480,
      values: { value: 32.5 },
      unit: '℃',
      quality: 'unknown',
      source: {
        platform: 'ios',
        deviceId: 'synthetic-ring',
        vendor,
        model: 'R8',
        firmware: '869',
        deviceCategory: 'ring',
        sourceApp: 'say-ring',
        origin: 'watch_history',
        measurementSource: 'wearable',
        rawVersion: 2,
        provenance: {
          timeBasis: 'sdk',
          temperatureKind: 'skin',
          intervalSeconds: 300,
        },
      },
    };
    const result = validateHealthRecord(input);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.record.source).toMatchObject(input.source);
  }
});
it('rejects separators, newline source IDs and fabricated sampling metadata', () => {
  const base = {
    id: 'source',
    metric: 'heart_rate',
    observedAt: '2026-10-01T01:00:00Z',
    timezoneOffsetMinutes: 0,
    values: { value: 70 },
  };
  for (const source of [
    { platform: 'ios', vendor: 'a|b' },
    { platform: 'ios', vendor: 'a\nb' },
    { platform: 'ios', provenance: { intervalSeconds: -1 } },
    { platform: 'ios', provenance: { temperatureKind: 'core' } },
  ])
    expect(validateHealthRecord({ ...base, source }).valid).toBe(false);
});
