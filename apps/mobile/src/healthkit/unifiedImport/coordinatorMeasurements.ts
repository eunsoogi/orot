import type { HealthKitFeature } from '../types';
import type {
  UnifiedFeatureInstrumentation,
  UnifiedImportMeasurement,
} from './types';
import type { ActiveRun } from './coordinatorProgress';
import { recordMeasurement, setFeature } from './coordinatorProgress';

export function featureInstrumentation(
  run: ActiveRun,
  feature: HealthKitFeature,
  now: () => number,
): UnifiedFeatureInstrumentation {
  return {
    query: operation => {
      setFeature(run, feature, { status: 'querying' });
      return measure(run, 'healthKit', 'query', operation, now);
    },
    persist: operation => {
      setFeature(run, feature, { status: 'persisting' });
      return measure(run, 'localStore', 'persistence', operation, now);
    },
  };
}

export async function measure<T>(
  run: ActiveRun,
  provider: UnifiedImportMeasurement['provider'],
  phase: UnifiedImportMeasurement['phase'],
  operation: () => Promise<T>,
  now: () => number,
): Promise<T> {
  recordMeasurement(run, { provider, phase, transition: 'started' }, now);
  const startedAt = now();
  try {
    const result = await operation();
    recordMeasurement(
      run,
      {
        provider,
        phase,
        transition: 'finished',
        durationMs: elapsedMilliseconds(startedAt, now()),
        outcome: 'completed',
      },
      now,
    );
    return result;
  } catch (error) {
    recordMeasurement(
      run,
      {
        provider,
        phase,
        transition: 'finished',
        durationMs: elapsedMilliseconds(startedAt, now()),
        outcome: 'failed',
      },
      now,
    );
    throw error;
  }
}

function elapsedMilliseconds(start: number, end: number): number {
  return Math.round(Math.max(0, end - start));
}
