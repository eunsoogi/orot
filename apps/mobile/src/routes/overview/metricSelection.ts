import type { RecordRepository } from '@orot/storage';

export const overviewMetrics = [
  'sleep',
  'heartRate',
  'bodyMass',
  'steps',
  'workouts',
  'restingHeartRate',
  'walkingHeartRate',
] as const;
export type OverviewMetric = (typeof overviewMetrics)[number];
export const overviewMetricChoices = [
  ...overviewMetrics,
  'workoutHeartRate',
] as const;
/** Workout heart rate is selectable but is not a projected local snapshot metric. */
export type OverviewMetricChoice = (typeof overviewMetricChoices)[number];
export function isOverviewSnapshotMetric(
  metric: OverviewMetricChoice,
): metric is OverviewMetric {
  return metric !== 'workoutHeartRate';
}

export function isOverviewDerivedHeartRate(
  metric: OverviewMetric,
): metric is 'restingHeartRate' | 'walkingHeartRate' {
  return metric === 'restingHeartRate' || metric === 'walkingHeartRate';
}
export function isOverviewHeartRate(metric: OverviewMetric): boolean {
  return metric === 'heartRate' || isOverviewDerivedHeartRate(metric);
}
export const minimumOverviewMetricCount = 2;
// Keep the existing storage key so an upgrade preserves each user's selection.
const selectionKey = 'home:metric-selection:v1';
export const defaultOverviewMetrics: readonly OverviewMetric[] = [
  'sleep',
  'heartRate',
];

/** Selection is local presentation state, independent of HealthKit authorization and sync. */
export function validateOverviewMetricSelection(
  value: unknown,
): OverviewMetricChoice[] {
  if (
    !Array.isArray(value) ||
    value.length < minimumOverviewMetricCount ||
    value.some(metric => !overviewMetricChoices.includes(metric)) ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid Home metric selection.');
  return value as OverviewMetricChoice[];
}

export async function loadOverviewMetricSelection(
  repository: Pick<RecordRepository, 'getSyncCheckpoint'>,
): Promise<OverviewMetricChoice[]> {
  const checkpoint = await repository.getSyncCheckpoint(selectionKey);
  if (!checkpoint) return [...defaultOverviewMetrics];
  return validateOverviewMetricSelection(JSON.parse(checkpoint.value));
}

export async function saveOverviewMetricSelection(
  repository: Pick<RecordRepository, 'transaction'>,
  selection: readonly OverviewMetricChoice[],
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
