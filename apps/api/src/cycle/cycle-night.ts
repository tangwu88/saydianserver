import { safeObject } from '../common/crypto';
export type CycleSensorRow = {
  clientRecordId: string;
  metric: string;
  observedAt: Date;
  values: unknown;
  quality: string;
  sourceDeviceKey: string | null;
  sourceModel: string | null;
  sourceFirmware: string | null;
  sourceOrigin: string | null;
  sourceMetadata: unknown;
};
/** 只做描述性夜间特征，不能据此开放任何尚未验证的预测模型。 */
export function cycleNightSummary(rows: CycleSensorRow[], asOf: Date) {
  const features: Array<{
    date: string;
    sourceKey: string;
    metric: string;
    median: number;
    sampleCount: number;
    coverageMinutes: number;
    maxGapMinutes: number;
    recordIds: string[];
    enhancementEligible: boolean;
  }> = [];
  for (const sleep of rows.filter((r) => r.metric === 'SLEEP')) {
    const windows = safeObject(sleep.sourceMetadata).sleepWindows;
    if (!Array.isArray(windows) || !sleep.sourceDeviceKey) continue;
    for (const raw of windows) {
      const w = safeObject(raw),
        start = +new Date(String(w.startAt)),
        end = +new Date(String(w.endAt));
      if (
        w.kind !== 'night' ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end > +asOf ||
        end - start < 4 * 3600000
      )
        continue;
      const groups = new Map<string, CycleSensorRow[]>();
      for (const row of rows) {
        const meta = safeObject(row.sourceMetadata),
          p = safeObject(meta.provenance);
        if (
          row.sourceDeviceKey !== sleep.sourceDeviceKey ||
          row.sourceOrigin !== 'watch_history' ||
          +row.observedAt < start ||
          +row.observedAt >= end ||
          ['INVALID', 'SUSPECT'].includes(row.quality) ||
          !row.sourceFirmware ||
          !meta.vendor ||
          !['sdk', 'slot'].includes(String(p.timeBasis)) ||
          p.contactVerified === false ||
          p.sdkQuality === 0 ||
          safeObject(row.values).sdkQuality === 0 ||
          (typeof p.validCount === 'number' && p.validCount < 2)
        )
          continue;
        const metric =
          row.metric === 'TEMPERATURE' && p.temperatureKind === 'skin'
            ? 'skin_temperature'
            : row.metric === 'HEART_RATE'
              ? 'sleep_heart_rate'
              : row.metric === 'HRV' &&
                  ['sdnn', 'rmssd'].includes(String(p.algorithm))
                ? `hrv_${p.algorithm}`
                : null;
        if (!metric) continue;
        const key = [
          row.sourceDeviceKey,
          meta.vendor,
          row.sourceModel,
          row.sourceFirmware,
          metric,
        ].join('|');
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
      }
      for (const [sourceKey, group] of groups) {
        const p = safeObject(safeObject(group[0]!.sourceMetadata).provenance),
          interval = Number(p.intervalSeconds) * 1000;
        if (
          !Number.isFinite(interval) ||
          interval <= 0 ||
          group.some(
            (r) =>
              safeObject(safeObject(r.sourceMetadata).provenance)
                .intervalSeconds !== p.intervalSeconds,
          )
        )
          continue;
        const samples = [
          ...new Map(group.map((r) => [+r.observedAt, r])).values(),
        ].sort((a, b) => +a.observedAt - +b.observedAt);
        const coverage = Math.min(end - start, samples.length * interval);
        let gap = Math.max(
          +samples[0]!.observedAt - start,
          end - +samples[samples.length - 1]!.observedAt,
        );
        for (let i = 1; i < samples.length; i++)
          gap = Math.max(
            gap,
            +samples[i]!.observedAt - +samples[i - 1]!.observedAt,
          );
        if (
          samples.length < 4 ||
          coverage / (end - start) < 0.7 ||
          gap > 3600000
        )
          continue;
        const metric = sourceKey.split('|')[4]!;
        const values = samples
          .map((r) => {
            const v = safeObject(r.values);
            return Number(
              metric === 'skin_temperature'
                ? (v.skinTemperature ?? v.value)
                : metric.startsWith('hrv_')
                  ? v[String(p.algorithm)]
                  : v.value,
            );
          })
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        if (values.length !== samples.length) continue;
        const median =
          values.length % 2
            ? values[values.length >> 1]!
            : (values[(values.length >> 1) - 1]! +
                values[values.length >> 1]!) /
              2;
        features.push({
          date: String(w.date),
          sourceKey,
          metric,
          median,
          sampleCount: samples.length,
          coverageMinutes: coverage / 60000,
          maxGapMinutes: gap / 60000,
          recordIds: samples.map((r) => r.clientRecordId),
          enhancementEligible: samples.every(
            (r) =>
              safeObject(safeObject(r.sourceMetadata).provenance)
                .contactVerified === true,
          ),
        });
      }
    }
  }
  const unique = [
    ...new Map(features.map((f) => [`${f.sourceKey}|${f.date}`, f])).values(),
  ];
  const temperature = unique
    .filter((f) => f.metric === 'skin_temperature')
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = temperature[temperature.length - 1];
  const source = latest
    ? temperature.filter((f) => f.sourceKey === latest.sourceKey)
    : [];
  const tail = source.slice(-7).map((f) => f.median),
    older = source.slice(-28, -7).map((f) => f.median);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const direction =
    tail.length >= 3 && older.length >= 7
      ? mean(tail) > mean(older)
        ? 'higher'
        : mean(tail) < mean(older)
          ? 'lower'
          : 'stable'
      : 'unknown';
  return {
    features: unique,
    summary: {
      usableNights: new Set(unique.map((f) => f.date)).size,
      temperatureNights: source.length,
      temperatureDirection: direction,
      enhanced: false,
    },
  };
}
