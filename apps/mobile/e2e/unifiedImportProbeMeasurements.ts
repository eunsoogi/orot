import type { UnifiedImportMeasurement } from '../src/healthkit/unifiedImport/types';

/** Emits provider and phase timings only; source values and records stay private. */
export function summarizeUnifiedImportMeasurements(
  measurements: readonly UnifiedImportMeasurement[],
): string {
  const matches = (
    item: UnifiedImportMeasurement,
    provider: string,
    phase: string,
    transition: UnifiedImportMeasurement['transition'],
    sourceProvider?: UnifiedImportMeasurement['sourceProvider'],
  ) =>
    item.provider === provider &&
    item.phase === phase &&
    item.transition === transition &&
    item.sourceProvider === sourceProvider;
  const count = (
    provider: string,
    phase: string,
    sourceProvider?: UnifiedImportMeasurement['sourceProvider'],
  ) =>
    measurements.filter(item =>
      matches(item, provider, phase, 'started', sourceProvider),
    ).length;
  const find = (
    provider: string,
    phase: string,
    transition: UnifiedImportMeasurement['transition'],
    sourceProvider?: UnifiedImportMeasurement['sourceProvider'],
  ) =>
    measurements.find(item =>
      matches(item, provider, phase, transition, sourceProvider),
    );
  const findLast = (
    provider: string,
    phase: string,
    transition: UnifiedImportMeasurement['transition'],
    sourceProvider?: UnifiedImportMeasurement['sourceProvider'],
  ) =>
    [...measurements]
      .reverse()
      .find(item => matches(item, provider, phase, transition, sourceProvider));
  const duration = (
    provider: string,
    phase: string,
    sourceProvider?: UnifiedImportMeasurement['sourceProvider'],
  ) =>
    measurements
      .filter(item =>
        matches(item, provider, phase, 'finished', sourceProvider),
      )
      .reduce((total, item) => total + (item.durationMs ?? 0), 0);
  const healthKitAuthorizationStarted = find(
    'healthKit',
    'authorization',
    'started',
  );
  const healthKitRequestInvocation = find(
    'healthKit',
    'permissionRequestInvocation',
    'invoked',
  );
  const healthKitAuthorizationFinished = find(
    'healthKit',
    'authorization',
    'finished',
  );
  const eventKitAuthorizationStarted = find(
    'eventKit',
    'authorization',
    'started',
  );
  const eventKitRequestInvocation = find(
    'eventKit',
    'permissionRequestInvocation',
    'invoked',
  );
  const eventKitAuthorizationFinished = find(
    'eventKit',
    'authorization',
    'finished',
  );
  const storagePreparationStarted = find(
    'localStore',
    'storagePreparation',
    'started',
  );
  const storagePreparationFinished = findLast(
    'localStore',
    'storagePreparation',
    'finished',
  );

  return [
    `healthKitAuthorizationCalls=${count('healthKit', 'authorization')}`,
    `healthKitAuthorizationStartOffsetMs=${healthKitAuthorizationStarted?.offsetMs ?? 0}`,
    `healthKitRequestInvocationOffsetMs=${healthKitRequestInvocation?.offsetMs ?? 0}`,
    `healthKitAuthorizationFinishedOffsetMs=${healthKitAuthorizationFinished?.offsetMs ?? 0}`,
    `healthKitAuthorizationMs=${duration('healthKit', 'authorization')}`,
    `eventKitAuthorizationCalls=${count('eventKit', 'authorization')}`,
    `eventKitAuthorizationStartOffsetMs=${eventKitAuthorizationStarted?.offsetMs ?? 0}`,
    `eventKitRequestInvocationOffsetMs=${eventKitRequestInvocation?.offsetMs ?? 0}`,
    `eventKitAuthorizationFinishedOffsetMs=${eventKitAuthorizationFinished?.offsetMs ?? 0}`,
    `eventKitAuthorizationMs=${duration('eventKit', 'authorization')}`,
    `healthKitQueryCalls=${count('healthKit', 'query')}`,
    `healthKitQueryStartOffsetMs=${find('healthKit', 'query', 'started')?.offsetMs ?? 0}`,
    `healthKitQueryFinishedOffsetMs=${findLast('healthKit', 'query', 'finished')?.offsetMs ?? 0}`,
    `healthKitQueryMs=${duration('healthKit', 'query')}`,
    `eventKitQueryCalls=${count('eventKit', 'query')}`,
    `eventKitQueryStartOffsetMs=${find('eventKit', 'query', 'started')?.offsetMs ?? 0}`,
    `eventKitQueryFinishedOffsetMs=${findLast('eventKit', 'query', 'finished')?.offsetMs ?? 0}`,
    `eventKitQueryMs=${duration('eventKit', 'query')}`,
    `healthKitPersistenceOperations=${count('localStore', 'persistence', 'healthKit')}`,
    `healthKitPersistenceStartOffsetMs=${find('localStore', 'persistence', 'started', 'healthKit')?.offsetMs ?? 0}`,
    `healthKitPersistenceFinishedOffsetMs=${findLast('localStore', 'persistence', 'finished', 'healthKit')?.offsetMs ?? 0}`,
    `healthKitPersistenceMs=${duration('localStore', 'persistence', 'healthKit')}`,
    `eventKitPersistenceOperations=${count('localStore', 'persistence', 'eventKit')}`,
    `eventKitPersistenceStartOffsetMs=${find('localStore', 'persistence', 'started', 'eventKit')?.offsetMs ?? 0}`,
    `eventKitPersistenceFinishedOffsetMs=${findLast('localStore', 'persistence', 'finished', 'eventKit')?.offsetMs ?? 0}`,
    `eventKitPersistenceMs=${duration('localStore', 'persistence', 'eventKit')}`,
    `localStorePreparationStartOffsetMs=${storagePreparationStarted?.offsetMs ?? 0}`,
    `localStorePreparationFinishedOffsetMs=${storagePreparationFinished?.offsetMs ?? 0}`,
    `localStorePreparationMs=${duration('localStore', 'storagePreparation')}`,
  ].join(';');
}
