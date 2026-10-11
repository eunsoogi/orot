import type { RecordRepository } from '@orot/storage';
import type {
  HealthKitAuthorizationResult,
  HealthKitNativeModule,
  HealthKitFeature,
} from '../types';
import { syncHealthKitBloodPressure } from '../bloodPressure/sync';
import type { BloodPressureSyncResult } from '../bloodPressure/types';
import { syncCommonObservationChanges } from '../commonObservations/sync';
import type { CommonObservationSyncResult } from '../commonObservations/sync';
import {
  commonObservationFeatures,
  type CommonObservationFeature,
} from '../commonObservations/types';
import { syncHealthKitMedications } from '../medications/importer';
import type { MedicationSyncResult } from '../medications/syncTypes';
import { syncHealthKitSleep } from '../sleep/importer';
import type { SleepSyncResult } from '../sleep/importer';
import type {
  UnifiedFeatureInstrumentation,
  UnifiedFeatureOutcome,
} from './types';

/** Adapts each existing importer to one completed batch without exposing grant state. */
export function createUnifiedFeatureImporter(options: {
  readonly healthKit: Pick<
    HealthKitNativeModule,
    'querySampleChanges' | 'queryMedicationDefinitions'
  >;
  readonly now: () => string;
}): (
  feature: HealthKitFeature,
  authorization: HealthKitAuthorizationResult,
  repository: RecordRepository,
  instrumentation: UnifiedFeatureInstrumentation,
) => Promise<UnifiedFeatureOutcome> {
  return async (feature, authorization, repository, instrumentation) => {
    const now = options.now;

    if (
      commonObservationFeatures.includes(feature as CommonObservationFeature)
    ) {
      const result = await syncCommonObservationChanges({
        feature: feature as CommonObservationFeature,
        authorization,
        healthKit: options.healthKit,
        repository,
        instrumentation,
        now,
        rememberForAutoSync: true,
      });
      return commonOutcome(result);
    }
    const healthKitClient = instrumentHealthKit(
      options.healthKit,
      instrumentation,
    );
    const instrumentedRepository = instrumentRepository(
      repository,
      instrumentation,
    );
    if (feature === 'bloodPressure') {
      const result = await syncHealthKitBloodPressure({
        authorization,
        healthKit: healthKitClient,
        repository: instrumentedRepository,
        now,
        rememberForAutoSync: true,
      });
      return bloodPressureOutcome(result);
    }
    if (feature === 'sleep') {
      const result = await syncHealthKitSleep({
        healthKit: healthKitClient,
        repository: instrumentedRepository,
        now,
      });
      return sleepOutcome(result);
    }
    if (feature === 'medications') {
      const result = await syncHealthKitMedications({
        healthKit: healthKitClient,
        repository: instrumentedRepository,
        now,
      });
      return medicationOutcome(result);
    }
    return { status: 'unsupportedFeature', importedCount: 0, deletedCount: 0 };
  };
}

function instrumentHealthKit(
  client: Pick<
    HealthKitNativeModule,
    'querySampleChanges' | 'queryMedicationDefinitions'
  >,
  instrumentation: UnifiedFeatureInstrumentation,
) {
  return {
    querySampleChanges: (
      query: Parameters<HealthKitNativeModule['querySampleChanges']>[0],
    ) => instrumentation.query(() => client.querySampleChanges(query)),
    queryMedicationDefinitions: (limit: number) =>
      instrumentation.query(() => client.queryMedicationDefinitions(limit)),
  };
}

function instrumentRepository(
  repository: RecordRepository,
  instrumentation: UnifiedFeatureInstrumentation,
): RecordRepository {
  const transaction: RecordRepository['transaction'] = operation =>
    instrumentation.persist(() => repository.transaction(operation));
  return new Proxy(repository, {
    get(target, property) {
      if (property === 'transaction') return transaction;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function commonOutcome(
  result: CommonObservationSyncResult,
): UnifiedFeatureOutcome {
  return {
    status: result.status,
    importedCount: result.upserted,
    deletedCount: result.deleted,
  };
}

function bloodPressureOutcome(
  result: BloodPressureSyncResult,
): UnifiedFeatureOutcome {
  return {
    status:
      result.status === 'completed'
        ? result.upserted + result.deleted > 0
          ? 'complete'
          : 'empty'
        : result.status === 'partial'
          ? 'partial'
          : 'notRun',
    importedCount: result.upserted,
    deletedCount: result.deleted,
  };
}

function sleepOutcome(result: SleepSyncResult): UnifiedFeatureOutcome {
  return {
    status:
      result.status === 'completed'
        ? result.upserted + result.deleted > 0
          ? 'complete'
          : 'empty'
        : result.status === 'partial'
          ? 'partial'
          : result.availability === 'available'
            ? 'notRun'
            : result.availability,
    importedCount: result.upserted,
    deletedCount: result.deleted,
  };
}

function medicationOutcome(
  result: MedicationSyncResult,
): UnifiedFeatureOutcome {
  const importedCount =
    result.definitions.upserted + result.doseEvents.upserted;
  const deletedCount = result.definitions.deleted + result.doseEvents.deleted;
  const completed =
    result.definitions.status === 'completed' &&
    result.doseEvents.status === 'completed';
  const partiallyCompleted =
    result.definitions.status === 'completed' ||
    result.doseEvents.status === 'completed' ||
    result.doseEvents.status === 'partial';
  return {
    status: completed
      ? importedCount + deletedCount > 0
        ? 'complete'
        : 'empty'
      : partiallyCompleted
        ? 'partial'
        : 'notRun',
    importedCount,
    deletedCount,
  };
}
