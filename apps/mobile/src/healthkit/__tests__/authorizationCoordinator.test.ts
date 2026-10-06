import type { HealthKitNativeModule } from '../types';
import { requestHealthKitBatchAuthorization } from '../authorizationCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('HealthKit batch authorization coordinator', () => {
  it('shares one pending request for the same normalized selection', async () => {
    const authorization =
      deferred<
        Awaited<ReturnType<HealthKitNativeModule['requestReadAuthorizations']>>
      >();
    const healthKit = {
      requestReadAuthorizations: jest.fn(() => authorization.promise),
    };
    const options = {
      healthKit,
      features: ['steps', 'heartRate'] as const,
    };

    const first = requestHealthKitBatchAuthorization(options);
    const overlapping = requestHealthKitBatchAuthorization({
      ...options,
      features: ['heartRate', 'steps'],
    });

    expect(overlapping).toBe(first);
    await Promise.resolve();
    expect(healthKit.requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(healthKit.requestReadAuthorizations).toHaveBeenCalledWith([
      'heartRate',
      'steps',
    ]);

    authorization.resolve({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: ['heartRate', 'steps'],
      unsupportedFeatures: [],
    });
    await expect(first).resolves.toMatchObject({
      availability: 'available',
      requestedFeatures: ['heartRate', 'steps'],
      readAuthorization: 'notObservable',
    });
    await expect(overlapping).resolves.toEqual(await first);
  });

  it('clears rejected requests so an explicit retry reaches native HealthKit', async () => {
    const failure = new Error('native request failed');
    const healthKit = {
      requestReadAuthorizations: jest
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({
          availability: 'available' as const,
          requestStatus: 'completed' as const,
          readAuthorization: 'notObservable' as const,
          requestedFeatures: ['bodyMass' as const],
          unsupportedFeatures: [],
        }),
    };

    await expect(
      requestHealthKitBatchAuthorization({
        healthKit,
        features: ['bodyMass'],
      }),
    ).rejects.toBe(failure);
    await expect(
      requestHealthKitBatchAuthorization({
        healthKit,
        features: ['bodyMass'],
      }),
    ).resolves.toMatchObject({ requestStatus: 'completed' });
    expect(healthKit.requestReadAuthorizations).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty or repeated selection before calling the native module', async () => {
    const healthKit = { requestReadAuthorizations: jest.fn() };

    await expect(
      requestHealthKitBatchAuthorization({ healthKit, features: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      requestHealthKitBatchAuthorization({
        healthKit,
        features: ['steps', 'steps'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(healthKit.requestReadAuthorizations).not.toHaveBeenCalled();
  });
});
