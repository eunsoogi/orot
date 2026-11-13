import type { RecordRepository } from '@orot/storage';

export const overviewMetrics = [
  'sleep',
  'heartRate',
  'bodyMass',
  'steps',
] as const;
export type OverviewMetric = (typeof overviewMetrics)[number];
// Keep the existing storage key so an upgrade preserves each user's selection.
const selectionKey = 'home:metric-selection:v1';
export const defaultOverviewMetrics: readonly OverviewMetric[] = [
  'sleep',
  'heartRate',
];

/** Selection is local presentation state, independent of HealthKit authorization and sync. */
export function validateOverviewMetricSelection(
  value: unknown,
): OverviewMetric[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > 4 ||
    value.some(metric => !overviewMetrics.includes(metric)) ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid Home metric selection.');
  return value as OverviewMetric[];
}

export async function loadOverviewMetricSelection(
  repository: Pick<RecordRepository, 'getSyncCheckpoint'>,
): Promise<OverviewMetric[]> {
  const checkpoint = await repository.getSyncCheckpoint(selectionKey);
  if (!checkpoint) return [...defaultOverviewMetrics];
  return validateOverviewMetricSelection(JSON.parse(checkpoint.value));
}

export async function saveOverviewMetricSelection(
  repository: Pick<RecordRepository, 'transaction'>,
  selection: readonly OverviewMetric[],
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const valid = validateOverviewMetricSelection(selection);
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: selectionKey,
      value: JSON.stringify(valid),
      updatedAt: now(),
    }),
  );
}
