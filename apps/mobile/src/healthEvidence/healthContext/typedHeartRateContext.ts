import type { SqlExecutor } from '@orot/storage';
import { supportedTypedHeartRatePeriod, typedHeartRateMaxRows } from '../typedHeartRateWindow';
import { readTypedHeartRateSnapshot, typedHeartRateContextFits } from '../typedHeartRateEvidence';
import { readHealthContextGeneration } from './generation';
import type { HealthContextReport, HealthContextWindow } from './types';

/** Reuse the protected period owner without projecting generic quantities or a private member ID. */
export async function readTypedHeartRateContext(
  tx: SqlExecutor,
  window: HealthContextWindow,
  signal?: AbortSignal,
): Promise<HealthContextReport> {
  const category = window.typedHeartRateCategory;
  if (
    !category ||
    window.doseHistory ||
    window.dataAvailableThrough ||
    !supportedTypedHeartRatePeriod(window.fromInclusive, window.toExclusive)
  )
    throw new RangeError('Invalid typed heart-rate context.');
  const before = await readHealthContextGeneration(tx);
  const fits = await typedHeartRateContextFits(tx, category, window, signal);
  const proof = fits
    ? await readTypedHeartRateSnapshot(tx, category, window, signal, typedHeartRateMaxRows)
    : null;
  const generation = await readHealthContextGeneration(tx);
  if (
    before.mutationGeneration !== generation.mutationGeneration ||
    before.deletionGeneration !== generation.deletionGeneration
  )
    throw new Error('Typed heart-rate source changed during aggregation.');
  return {
    window,
    days: [],
    quantities: [],
    medications: [],
    sleep: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: proof
      ? []
      : [fits ? 'typed_heart_rate_unavailable' : 'typed_heart_rate_scope_too_large'],
    ...(proof
      ? {
          typedHeartRate: {
            category: proof.category,
            unit: proof.unit,
            meanBpm: proof.meanBpm,
            sampleCount: proof.sampleCount,
            membershipRevision: proof.membershipRevision,
          },
        }
      : {}),
    ...generation,
  };
}
