import type {
  HealthKitBatchAuthorizationResult,
  HealthKitAuthorizationResult,
  HealthKitAvailability,
  HealthKitFeature,
  HealthKitMedicationQueryResult,
  HealthKitNativeModule,
  HealthKitSampleChangesQuery,
  HealthKitSampleChangesResult,
  HealthKitSampleQuery,
  HealthKitSampleQueryResult,
} from './types';
import {
  assertFeature,
  codedError,
  requireAuthorizationResult,
  requireAvailability,
  requireMedicationQueryResult,
  requireSampleQueryResult,
  validateMedicationDefinitionLimit,
  validateSampleQuery,
} from './validation';
import {
  requireBatchAuthorizationResult,
  validateAuthorizationFeatures,
} from './batchAuthorizationValidation';
import {
  requireSampleChangesResult,
  validateSampleChangesQuery,
} from './sampleChangesValidation';

type MobilePlatform = 'ios' | 'android' | 'other';

// Client construction is inert; callers opt into a feature-specific request explicitly.
export function createHealthKitClient(
  nativeModule: HealthKitNativeModule | undefined,
  platform: MobilePlatform,
) {
  function unsupportedAvailability(): HealthKitAvailability {
    return { status: 'unsupportedPlatform' };
  }

  function requireNativeModule(): HealthKitNativeModule {
    if (nativeModule) return nativeModule;
    throw codedError(
      'NATIVE_MODULE_UNAVAILABLE',
      'HealthKit native module is not registered.',
    );
  }

  return {
    async getAvailability(): Promise<HealthKitAvailability> {
      if (platform !== 'ios') return unsupportedAvailability();
      return requireAvailability(await requireNativeModule().getAvailability());
    },

    async requestReadAuthorization(
      feature: HealthKitFeature,
    ): Promise<HealthKitAuthorizationResult> {
      assertFeature(feature);
      if (platform !== 'ios') {
        return {
          availability: 'unsupportedPlatform',
          requestStatus: 'notRequested',
          readAuthorization: 'notObservable',
        };
      }
      return requireAuthorizationResult(
        await requireNativeModule().requestReadAuthorization(feature),
      );
    },

    async requestReadAuthorizations(
      features: readonly HealthKitFeature[],
    ): Promise<HealthKitBatchAuthorizationResult> {
      validateAuthorizationFeatures(features);
      if (platform !== 'ios') {
        return {
          availability: 'unsupportedPlatform',
          requestStatus: 'notRequested',
          readAuthorization: 'notObservable',
          requestedFeatures: [],
          unsupportedFeatures: [],
        };
      }
      return requireBatchAuthorizationResult(
        await requireNativeModule().requestReadAuthorizations(features),
        features,
      );
    },

    async querySamples(
      query: HealthKitSampleQuery,
    ): Promise<HealthKitSampleQueryResult> {
      validateSampleQuery(query);
      if (platform !== 'ios') {
        return {
          availability: 'unsupportedPlatform',
          status: 'notRun',
          readAuthorization: 'notObservable',
        };
      }
      return requireSampleQueryResult(
        await requireNativeModule().querySamples(query),
      );
    },

    async queryMedicationDefinitions(
      limit = 200,
    ): Promise<HealthKitMedicationQueryResult> {
      validateMedicationDefinitionLimit(limit);
      if (platform !== 'ios') {
        return {
          availability: 'unsupportedPlatform',
          status: 'notRun',
          readAuthorization: 'notObservable',
        };
      }
      return requireMedicationQueryResult(
        await requireNativeModule().queryMedicationDefinitions(limit),
      );
    },

    // The cursor belongs to the requested feature and sample kind and stays opaque to callers.
    async querySampleChanges(
      query: HealthKitSampleChangesQuery,
    ): Promise<HealthKitSampleChangesResult> {
      validateSampleChangesQuery(query);
      if (platform !== 'ios') {
        return {
          availability: 'unsupportedPlatform',
          status: 'notRun',
          readAuthorization: 'notObservable',
        };
      }
      return requireSampleChangesResult(
        await requireNativeModule().querySampleChanges(query),
      );
    },
  };
}
