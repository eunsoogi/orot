import type { UnifiedImportMeasurement } from '../src/healthkit/unifiedImport/types';

/** Emits aggregate phase measurements only; source values and provider records stay private. */
export function summarizeUnifiedImportMeasurements(
  measurements: readonly UnifiedImportMeasurement[],
): string {
  const started = (provider: string, phase: string) =>
    measurements.filter(
      item =>
        item.provider === provider &&
        item.phase === phase &&
        item.transition === 'started',
    ).length;
  const duration = (provider: string, phase: string) =>
    measurements
      .filter(
        item =>
          item.provider === provider &&
          item.phase === phase &&
          item.transition === 'finished',
      )
      .reduce((total, item) => total + (item.durationMs ?? 0), 0);
  const find = (
    provider: string,
    phase: string,
    transition: UnifiedImportMeasurement['transition'],
  ) =>
    measurements.find(
      item =>
        item.provider === provider &&
        item.phase === phase &&
        item.transition === transition,
    );
  const healthKitRequestInvocation = find(
    'healthKit',
    'permissionRequestInvocation',
    'invoked',
  );
  const healthKitAuthorizationStarted = find(
    'healthKit',
    'authorization',
    'started',
  );
  const healthKitAuthorizationFinished = find(
    'healthKit',
    'authorization',
    'finished',
  );
  const firstQuery = find('healthKit', 'query', 'started');
  return [
    `healthKitAuthorizationCalls=${started('healthKit', 'authorization')}`,
    `healthKitAuthorizationStartOffsetMs=${healthKitAuthorizationStarted?.offsetMs ?? 0}`,
    `healthKitRequestInvocationOffsetMs=${healthKitRequestInvocation?.offsetMs ?? 0}`,
    `healthKitAuthorizationFinishedOffsetMs=${healthKitAuthorizationFinished?.offsetMs ?? 0}`,
    `healthKitQueryCalls=${started('healthKit', 'query')}`,
    `firstQueryOffsetMs=${firstQuery?.offsetMs ?? 0}`,
    `localStoreOperations=${started('localStore', 'persistence')}`,
    `healthKitAuthorizationMs=${duration('healthKit', 'authorization')}`,
    `localStoreMs=${duration('localStore', 'persistence')}`,
  ].join(';');
}
