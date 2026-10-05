import type {
  HealthKitAuthorizationResult,
  HealthKitAvailability,
  HealthKitFeature,
  HealthKitMedicationQueryResult,
  HealthKitNativeModule,
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
  validateLimit,
  validateSampleQuery,
} from './validation';

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
      validateLimit(limit);
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
  };
}
