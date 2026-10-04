import { createHealthKitClient } from '../client';
import type { HealthKitNativeModule } from '../types';

describe('HealthKit client boundary', () => {
  function nativeModule(): jest.Mocked<HealthKitNativeModule> {
    return {
      getAvailability: jest.fn().mockResolvedValue({ status: 'available' }),
      requestReadAuthorization: jest.fn().mockResolvedValue({
        availability: 'available',
        requestStatus: 'completed',
        readAuthorization: 'notObservable',
      }),
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
        medications: [],
      }),
    };
  }

  it('does not request access while constructing the client or checking availability', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');

    expect(native.requestReadAuthorization).not.toHaveBeenCalled();
    await expect(healthKit.getAvailability()).resolves.toEqual({ status: 'available' });
    expect(native.requestReadAuthorization).not.toHaveBeenCalled();
  });

  it('requests one named feature and never converts request completion into read approval', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');

    const result = await healthKit.requestReadAuthorization('steps');

    expect(native.requestReadAuthorization).toHaveBeenCalledTimes(1);
    expect(native.requestReadAuthorization).toHaveBeenCalledWith('steps');
    expect(result).toEqual({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
    });
    expect(result).not.toHaveProperty('granted');
    expect(result).not.toHaveProperty('denied');
  });

  it('keeps a failed request for one feature separate from other feature queries', async () => {
    const native = nativeModule();
    const failure = new Error('HealthKit request failed.');
    native.requestReadAuthorization.mockRejectedValueOnce(failure);
    const healthKit = createHealthKitClient(native, 'ios');

    await expect(healthKit.requestReadAuthorization('steps')).rejects.toBe(failure);
    const sleepQuery = {
      feature: 'sleep' as const,
      sampleKind: 'sleep' as const,
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-02T00:00:00.000Z',
      limit: 10,
    };
    await expect(healthKit.querySamples(sleepQuery)).resolves.toMatchObject({ status: 'completed' });
    expect(native.querySamples).toHaveBeenCalledWith(sleepQuery);
  });

  it('rejects native read-grant or read-denial claims instead of exposing them', async () => {
    const native = nativeModule();
    native.requestReadAuthorization.mockResolvedValue({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'denied',
    } as unknown as Awaited<ReturnType<HealthKitNativeModule['requestReadAuthorization']>>);
    const healthKit = createHealthKitClient(native, 'ios');

    await expect(healthKit.requestReadAuthorization('steps'))
      .rejects.toMatchObject({ code: 'INVALID_NATIVE_RESPONSE' });
  });

  it('rejects a native cancellation label that HealthKit does not provide', async () => {
    const native = nativeModule();
    native.requestReadAuthorization.mockResolvedValue({
      availability: 'available',
      requestStatus: 'cancelled',
      readAuthorization: 'notObservable',
    } as unknown as Awaited<ReturnType<HealthKitNativeModule['requestReadAuthorization']>>);
    const healthKit = createHealthKitClient(native, 'ios');

    await expect(healthKit.requestReadAuthorization('steps'))
      .rejects.toMatchObject({ code: 'INVALID_NATIVE_RESPONSE' });
  });

  it('keeps native request failures as errors instead of mapping them to a permission result', async () => {
    const native = nativeModule();
    const failure = new Error('HealthKit request failed.');
    native.requestReadAuthorization.mockRejectedValue(failure);
    const healthKit = createHealthKitClient(native, 'ios');

    await expect(healthKit.requestReadAuthorization('steps')).rejects.toBe(failure);
  });

  it('keeps an empty query as a completed query with unobservable read access', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');
    const result = await healthKit.querySamples({
      feature: 'steps',
      sampleKind: 'steps',
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-02T00:00:00.000Z',
      limit: 100,
    });

    expect(result).toEqual({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      samples: [],
    });
    expect(result).not.toHaveProperty('noData');
    expect(result).not.toHaveProperty('denied');
  });

  it('rejects a sample kind that belongs to a different feature before the native boundary', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');

    await expect(healthKit.querySamples({
      feature: 'sleep',
      sampleKind: 'steps',
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-02T00:00:00.000Z',
      limit: 100,
    })).rejects.toMatchObject({ code: 'FEATURE_SAMPLE_MISMATCH' });
    expect(native.querySamples).not.toHaveBeenCalled();
  });

  it('rejects invalid date ranges and unbounded limits before querying', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');
    const request = {
      feature: 'steps' as const,
      sampleKind: 'steps' as const,
      startDate: '2026-10-03T00:00:00.000Z',
      endDate: '2026-10-02T00:00:00.000Z',
      limit: 501,
    };

    await expect(healthKit.querySamples(request)).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
    await expect(healthKit.querySamples({ ...request, endDate: '2026-10-04T00:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'INVALID_LIMIT' });
    expect(native.querySamples).not.toHaveBeenCalled();
  });

  it('reports unsupported platforms without touching an absent HealthKit module', async () => {
    const healthKit = createHealthKitClient(undefined, 'android');

    await expect(healthKit.getAvailability()).resolves.toEqual({ status: 'unsupportedPlatform' });
    await expect(healthKit.requestReadAuthorization('sleep')).resolves.toEqual({
      availability: 'unsupportedPlatform',
      requestStatus: 'notRequested',
      readAuthorization: 'notObservable',
    });
    await expect(healthKit.querySamples({
      feature: 'sleep',
      sampleKind: 'sleep',
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-02T00:00:00.000Z',
      limit: 10,
    })).resolves.toMatchObject({ status: 'notRun', availability: 'unsupportedPlatform' });
  });

  it('exposes medication-definition queries through the medications feature only', async () => {
    const native = nativeModule();
    const healthKit = createHealthKitClient(native, 'ios');

    await healthKit.queryMedicationDefinitions(25);

    expect(native.queryMedicationDefinitions).toHaveBeenCalledWith(25);
    expect(native.queryMedicationDefinitions).toHaveBeenCalledTimes(1);
  });
});
