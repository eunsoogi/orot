import { createUnifiedImportCoordinator } from '../coordinator';
import { healthKitFeatures } from '../../types';
import { availableBatch, createTestServices } from '../testSupport';

describe('HealthKit import authorization ordering', () => {
  it('waits for one selected batch request before opening storage or querying', async () => {
    const base = createTestServices();
    const requestReadAuthorizations = jest.fn(async features => {
      base.timeline.push('healthKit.authorization.finished');
      return availableBatch(features);
    });
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: { requestReadAuthorizations },
    });
    const measurements: unknown[] = [];

    const result = await coordinator.start(
      { healthKitFeatures: ['steps', 'heartRate'] },
      { onMeasurement: measurement => measurements.push(measurement) },
    ).result;

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(requestReadAuthorizations).toHaveBeenCalledWith([
      'heartRate',
      'steps',
    ]);
    expect(
      base.timeline.indexOf('healthKit.authorization.finished'),
    ).toBeLessThan(base.timeline.indexOf('storage.open'));
    expect(base.timeline.indexOf('storage.open')).toBeLessThan(
      base.timeline.indexOf('query:heartRate'),
    );
    expect(result.status).toBe('complete');
    expect(result.readAuthorization).toBe('notObservable');
    expect(result.progress).not.toHaveProperty('calendar');
    expect(measurements).toEqual(result.measurements);
    const authorizationStart = result.measurements.find(
      measurement =>
        measurement.provider === 'healthKit' &&
        measurement.phase === 'authorization' &&
        measurement.transition === 'started',
    );
    const requestInvocation = result.measurements.find(
      measurement =>
        measurement.provider === 'healthKit' &&
        measurement.phase === 'permissionRequestInvocation',
    );
    expect(requestInvocation).toEqual({
      provider: 'healthKit',
      phase: 'permissionRequestInvocation',
      transition: 'invoked',
      offsetMs: expect.any(Number),
    });
    expect(requestInvocation?.offsetMs).toBeGreaterThanOrEqual(
      authorizationStart?.offsetMs ?? Number.POSITIVE_INFINITY,
    );
    expect(result.measurements).toContainEqual(
      expect.objectContaining({
        provider: 'localStore',
        phase: 'storagePreparation',
        transition: 'started',
        offsetMs: expect.any(Number),
      }),
    );
    const authorizationEnd = result.measurements.find(
      measurement =>
        measurement.provider === 'healthKit' &&
        measurement.phase === 'authorization' &&
        measurement.transition === 'finished',
    );
    const storageOpenEnd = result.measurements.find(
      measurement =>
        measurement.provider === 'localStore' &&
        measurement.phase === 'storagePreparation' &&
        measurement.transition === 'finished',
    );
    const firstQuery = result.measurements.find(
      measurement =>
        measurement.provider === 'healthKit' &&
        measurement.phase === 'query' &&
        measurement.transition === 'started',
    );
    expect(authorizationEnd?.offsetMs).toBeGreaterThanOrEqual(
      requestInvocation?.offsetMs ?? Number.POSITIVE_INFINITY,
    );
    expect(storageOpenEnd?.offsetMs).toBeGreaterThanOrEqual(
      authorizationEnd?.offsetMs ?? Number.POSITIVE_INFINITY,
    );
    expect(firstQuery?.offsetMs).toBeGreaterThanOrEqual(
      storageOpenEnd?.offsetMs ?? Number.POSITIVE_INFINITY,
    );
    expect(
      result.measurements.every(
        (measurement, index, items) =>
          index === 0 || measurement.offsetMs >= items[index - 1].offsetMs,
      ),
    ).toBe(true);
    expect(
      result.measurements
        .filter(measurement => measurement.transition === 'finished')
        .every(measurement => typeof measurement.durationMs === 'number'),
    ).toBe(true);
  });

  it('requests only selected types and reports unsupported types independently', async () => {
    const base = createTestServices();
    const requestReadAuthorizations = jest.fn(async () => ({
      availability: 'available' as const,
      requestStatus: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      requestedFeatures: ['heartRate'] as const,
      unsupportedFeatures: ['medications'] as const,
    }));
    const runFeature = jest.fn(base.services.runFeature);
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: { requestReadAuthorizations },
      runFeature,
    });

    const result = await coordinator.start({
      healthKitFeatures: ['medications', 'heartRate'],
    }).result;

    expect(requestReadAuthorizations).toHaveBeenCalledWith([
      'medications',
      'heartRate',
    ]);
    expect(runFeature).toHaveBeenCalledTimes(1);
    expect(runFeature).toHaveBeenCalledWith(
      'heartRate',
      expect.objectContaining({ requestStatus: 'completed' }),
      base.repository,
      expect.any(Object),
    );
    expect(result.progress.features.medications.status).toBe(
      'unsupportedFeature',
    );
    expect(result.progress.features.heartRate.status).toBe('complete');
    expect(result.status).toBe('partial');
  });

  it('uses one batch call for all six selected HealthKit features', async () => {
    const base = createTestServices();
    const requestReadAuthorizations = jest.fn(
      base.services.healthKit.requestReadAuthorizations,
    );
    const runFeature = jest.fn(base.services.runFeature);
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: { requestReadAuthorizations },
      runFeature,
    });

    const result = await coordinator.start({
      healthKitFeatures,
    }).result;

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(requestReadAuthorizations).toHaveBeenCalledWith(healthKitFeatures);
    expect(runFeature).toHaveBeenCalledTimes(healthKitFeatures.length);
    expect(base.timeline.indexOf('storage.open')).toBeGreaterThan(
      base.timeline.indexOf(
        'healthKit.authorization:medications,bloodPressure,sleep,heartRate,steps,bodyMass',
      ),
    );
    expect(result.status).toBe('complete');
  });

  it('fails selected types without exposing native errors when the batch request fails', async () => {
    const base = createTestServices({
      healthKit: {
        async requestReadAuthorizations() {
          throw new Error('private failure detail');
        },
      },
    });
    const coordinator = createUnifiedImportCoordinator(base.services);

    const result = await coordinator.start({
      healthKitFeatures: ['heartRate'],
    }).result;

    expect(base.timeline).not.toContain('storage.open');
    expect(result.progress.features.heartRate.status).toBe('failed');
    expect(
      result.measurements.some(measurement =>
        JSON.stringify(measurement).includes('private failure detail'),
      ),
    ).toBe(false);
    expect(result.status).toBe('failed');
  });
});
