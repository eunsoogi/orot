import type { RecordRepository } from '@orot/storage';

export const homeMetrics = ['sleep', 'heartRate', 'bodyMass', 'steps'] as const;
export type HomeMetric = (typeof homeMetrics)[number];
const selectionKey = 'home:metric-selection:v1';
export const defaultHomeMetrics: readonly HomeMetric[] = ['sleep', 'heartRate'];

/** Selection is local presentation state, independent of HealthKit authorization and sync. */
export function validateHomeMetricSelection(value: unknown): HomeMetric[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > 4 ||
    value.some(metric => !homeMetrics.includes(metric)) ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid Home metric selection.');
  return value as HomeMetric[];
}

export async function loadHomeMetricSelection(
  repository: Pick<RecordRepository, 'getSyncCheckpoint'>,
): Promise<HomeMetric[]> {
  const checkpoint = await repository.getSyncCheckpoint(selectionKey);
  if (!checkpoint) return [...defaultHomeMetrics];
  return validateHomeMetricSelection(JSON.parse(checkpoint.value));
}

export async function saveHomeMetricSelection(
  repository: Pick<RecordRepository, 'transaction'>,
  selection: readonly HomeMetric[],
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const valid = validateHomeMetricSelection(selection);
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: selectionKey,
      value: JSON.stringify(valid),
      updatedAt: now(),
    }),
  );
}
