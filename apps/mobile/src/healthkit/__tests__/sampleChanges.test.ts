import { createHealthKitClient } from '../client';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import type { HealthKitNativeModule } from '../types';

function nativeModule(): jest.Mocked<HealthKitNativeModule> {
  return {
    getAvailability: jest.fn().mockResolvedValue({ status: 'available' }),
    requestReadAuthorization: jest.fn().mockResolvedValue({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
    }),
    requestReadAuthorizations: jest.fn().mockImplementation(async features => ({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: features,
      unsupportedFeatures: [],
    })),
    querySamples: jest.fn().mockResolvedValue({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      samples: [],
    }),
    queryMedicationDefinitions: jest.fn().mockResolvedValue({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      completeSnapshot: true,
      medications: [],
    }),
    querySampleChanges: jest.fn().mockResolvedValue({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      addedSamples: [],
      deletedSampleIds: [],
      cursor: null,
      hasMore: false,
    }),
  };
}

describe('HealthKit sample change client', () => {
  it('scopes each checkpoint to a valid feature and sample kind pair', () => {
    expect(
      healthKitSampleChangesCheckpointKey(
        'medications',
        'medicationDoseEvents',
      ),
    ).toBe('healthkit:medications:medicationDoseEvents');
    expect(() =>
      healthKitSampleChangesCheckpointKey('medications', 'sleep'),
    ).toThrow(expect.objectContaining({ code: 'FEATURE_SAMPLE_MISMATCH' }));
  });

  it('preserves medication query limits and complete-snapshot evidence', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');
    native.queryMedicationDefinitions.mockResolvedValueOnce({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      completeSnapshot: true,
      medications: [],
    });

    await expect(
      healthKit.queryMedicationDefinitions(0),
    ).resolves.toMatchObject({
      completeSnapshot: true,
    });
    expect(native.queryMedicationDefinitions).toHaveBeenCalledWith(0);
  });

  it('passes the feature, sample kind, bound, and opaque cursor through one change query', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');
    const query = {
      feature: 'medications' as const,
      sampleKind: 'medicationDoseEvents' as const,
      limit: 120,
      cursor: 'opaque-current-anchor',
    };
    native.querySampleChanges.mockResolvedValueOnce({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      addedSamples: [],
      deletedSampleIds: ['dose-1'],
      cursor: 'opaque-next-anchor',
      hasMore: true,
    });

    await expect(healthKit.querySampleChanges(query)).resolves.toMatchObject({
      deletedSampleIds: ['dose-1'],
      cursor: 'opaque-next-anchor',
      hasMore: true,
      readAuthorization: 'notObservable',
    });
    expect(native.querySampleChanges).toHaveBeenCalledWith(query);
  });

  it('rejects mismatched features, unbounded pages, and oversized cursors before native calls', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');
    const query = {
      feature: 'sleep' as const,
      sampleKind: 'sleep' as const,
      limit: 20,
      cursor: null,
    };

    await expect(
      healthKit.querySampleChanges({ ...query, sampleKind: 'steps' }),
    ).rejects.toMatchObject({ code: 'FEATURE_SAMPLE_MISMATCH' });
    await expect(
      healthKit.querySampleChanges({ ...query, limit: 501 }),
    ).rejects.toMatchObject({ code: 'INVALID_LIMIT' });
    await expect(
      healthKit.querySampleChanges({ ...query, cursor: 'x'.repeat(1_000_001) }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(native.querySampleChanges).not.toHaveBeenCalled();
  });

  it('rejects malformed change pages and keeps unsupported platforms unrun', async () => {
    const native = nativeModule();
    native.querySampleChanges.mockResolvedValueOnce({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      addedSamples: [],
      deletedSampleIds: [],
      cursor: null,
    } as unknown as Awaited<
      ReturnType<HealthKitNativeModule['querySampleChanges']>
    >);
    const ios = createHealthKitClient(native, 'ios');
    const query = {
      feature: 'steps' as const,
      sampleKind: 'steps' as const,
      limit: 20,
      cursor: null,
    };

    await expect(ios.querySampleChanges(query)).rejects.toMatchObject({
      code: 'INVALID_NATIVE_RESPONSE',
    });
    const android = createHealthKitClient(undefined, 'android');
    await expect(android.querySampleChanges(query)).resolves.toMatchObject({
      availability: 'unsupportedPlatform',
      status: 'notRun',
    });
  });
});
