import { createHealthKitClient } from '../client';
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

describe('HealthKit batch authorization client', () => {
  it('sends one selected set and accepts a complete supported/unsupported partition', async () => {
    const native = nativeModule();
    native.requestReadAuthorizations.mockResolvedValueOnce({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: ['steps', 'heartRate'],
      unsupportedFeatures: ['medications'],
    });
    const healthKit = createHealthKitClient(native, 'ios');

    await expect(
      healthKit.requestReadAuthorizations([
        'heartRate',
        'steps',
        'medications',
      ]),
    ).resolves.toEqual({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: ['steps', 'heartRate'],
      unsupportedFeatures: ['medications'],
    });
    expect(native.requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(native.requestReadAuthorizations).toHaveBeenCalledWith([
      'heartRate',
      'steps',
      'medications',
    ]);
    expect(native.requestReadAuthorization).not.toHaveBeenCalled();
  });

  it('rejects invalid selections and mismatched native partitions before import', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');
    await expect(healthKit.requestReadAuthorizations([])).rejects.toMatchObject(
      { code: 'INVALID_REQUEST' },
    );
    await expect(
      healthKit.requestReadAuthorizations(['steps', 'steps']),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      healthKit.requestReadAuthorizations(['unknown'] as never),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FEATURE' });
    expect(native.requestReadAuthorizations).not.toHaveBeenCalled();

    native.requestReadAuthorizations.mockResolvedValueOnce({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: ['steps'],
      unsupportedFeatures: [],
    } as unknown as Awaited<
      ReturnType<HealthKitNativeModule['requestReadAuthorizations']>
    >);
    await expect(
      healthKit.requestReadAuthorizations(['heartRate', 'steps']),
    ).rejects.toMatchObject({ code: 'INVALID_NATIVE_RESPONSE' });
  });

  it('preserves request errors and rejects invented cancel status', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');
    const failure = new Error('HealthKit batch request failed.');
    native.requestReadAuthorizations.mockRejectedValueOnce(failure);
    await expect(
      healthKit.requestReadAuthorizations(['heartRate', 'steps']),
    ).rejects.toBe(failure);
    expect(native.requestReadAuthorization).not.toHaveBeenCalled();

    native.requestReadAuthorizations.mockResolvedValueOnce({
      availability: 'available',
      requestStatus: 'cancelled',
      readAuthorization: 'notObservable',
      requestedFeatures: ['heartRate'],
      unsupportedFeatures: ['steps'],
    } as unknown as Awaited<
      ReturnType<HealthKitNativeModule['requestReadAuthorizations']>
    >);
    await expect(
      healthKit.requestReadAuthorizations(['heartRate', 'steps']),
    ).rejects.toMatchObject({ code: 'INVALID_NATIVE_RESPONSE' });
  });

  it('does not access the native module on unsupported platforms', async () => {
    const healthKit = createHealthKitClient(undefined, 'android');
    await expect(
      healthKit.requestReadAuthorizations(['sleep', 'steps']),
    ).resolves.toEqual({
      availability: 'unsupportedPlatform',
      requestStatus: 'notRequested',
      readAuthorization: 'notObservable',
      requestedFeatures: [],
      unsupportedFeatures: [],
    });
  });
});
