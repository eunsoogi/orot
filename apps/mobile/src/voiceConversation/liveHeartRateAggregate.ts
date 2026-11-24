type Series = Record<string, unknown>;
const prefix = 'health_context: ';

/** Rebuild a provider payload from selected canonical numbers, never forward source text or rows. */
export function liveHeartRateAggregate(content: string, days: number) {
  if (!content.startsWith(prefix)) return;
  try {
    const value: unknown = JSON.parse(content.slice(prefix.length));
    if (!value || typeof value !== 'object') return;
    const { topic, quantities } = value as Series;
    if (topic !== 'measurements' || !Array.isArray(quantities)) return;
    const series = quantities.filter(
      (entry): entry is Series =>
        entry !== null &&
        typeof entry === 'object' &&
        entry.concept === 'heart_rate',
    );
    if (series.length !== 1) return;
    const { unit, sampleCount, recordedDays, meanOfRecordedDailyMeans } =
      series[0]!;
    if (
      unit !== 'count/min' ||
      typeof sampleCount !== 'number' ||
      !Number.isSafeInteger(sampleCount) ||
      typeof recordedDays !== 'number' ||
      !Number.isSafeInteger(recordedDays) ||
      recordedDays < 3 ||
      recordedDays > days ||
      sampleCount < recordedDays ||
      typeof meanOfRecordedDailyMeans !== 'number' ||
      !Number.isFinite(meanOfRecordedDailyMeans) ||
      meanOfRecordedDailyMeans <= 0
    )
      return;
    return {
      topic: 'measurements',
      metric: 'heart_rate',
      unit: 'count/min',
      days,
      sampleCount,
      meanOfRecordedDailyMeans: Math.round(meanOfRecordedDailyMeans),
    } as const;
  } catch {
    return undefined;
  }
}
