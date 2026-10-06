import { createUnifiedImportCoordinator } from '../coordinator';
import { healthKitFeatures } from '../../types';
import { availableBatch, createTestServices } from '../testSupport';

describe('unified import consent ordering', () => {
  it('finishes each selected consent call before calendar or HealthKit reads begin', async () => {
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
      { healthKitFeatures: ['steps', 'heartRate'], calendar: true },
      { onMeasurement: measurement => measurements.push(measurement) },
    ).result;

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(requestReadAuthorizations).toHaveBeenCalledWith([
      'heartRate',
      'steps',
    ]);
    expect(
      base.timeline.indexOf('healthKit.authorization.finished'),
    ).toBeLessThan(base.timeline.indexOf('eventKit.authorization'));
    expect(base.timeline.indexOf('eventKit.authorization')).toBeLessThan(
      base.timeline.indexOf('eventKit.query'),
    );
    expect(base.timeline.indexOf('eventKit.query')).toBeLessThan(
      base.timeline.indexOf('storage.open'),
    );
    expect(base.timeline.indexOf('storage.open')).toBeLessThan(
      base.timeline.indexOf('query:heartRate'),
    );
    expect(result.status).toBe('complete');
    expect(result.readAuthorization).toBe('notObservable');
    expect(result.progress.features.heartRate.status).toBe('complete');
    expect(result.progress.features.steps.status).toBe('complete');
    expect(result.progress.calendar.eventCount).toBe(0);
    expect(measurements).toEqual(result.measurements);
    expect(result.measurements).toContainEqual({
      provider: 'eventKit',
      phase: 'permissionRequestInvocation',
      transition: 'invoked',
      offsetMs: expect.any(Number),
    });
    expect(result.measurements).toContainEqual(
      expect.objectContaining({
        provider: 'localStore',
        phase: 'persistence',
        transition: 'started',
        offsetMs: expect.any(Number),
      }),
    );
    const healthKitAuthorizationEnd = result.measurements.find(
      measurement =>
        measurement.provider === 'healthKit' &&
        measurement.phase === 'authorization' &&
        measurement.transition === 'finished',
    );
    const eventKitRequest = result.measurements.find(
      measurement =>
        measurement.provider === 'eventKit' &&
        measurement.phase === 'permissionRequestInvocation',
    );
    const eventKitAuthorizationEnd = result.measurements.find(
      measurement =>
        measurement.provider === 'eventKit' &&
        measurement.phase === 'authorization' &&
        measurement.transition === 'finished',
    );
    const storageOpenEnd = result.measurements.find(
      measurement =>
        measurement.provider === 'localStore' &&
        measurement.phase === 'persistence' &&
        measurement.transition === 'finished',
    );
    const firstQuery = result.measurements.find(
      measurement =>
        measurement.provider === 'healthKit' &&
        measurement.phase === 'query' &&
        measurement.transition === 'started',
    );
    expect(eventKitRequest?.offsetMs).toBeGreaterThanOrEqual(
      healthKitAuthorizationEnd?.offsetMs ?? Number.POSITIVE_INFINITY,
    );
    expect(storageOpenEnd?.offsetMs).toBeGreaterThanOrEqual(
      eventKitAuthorizationEnd?.offsetMs ?? Number.POSITIVE_INFINITY,
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

  it('requests only supported selected types and reports an unsupported feature independently', async () => {
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
      calendar: false,
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
      healthKitFeatures: healthKitFeatures,
      calendar: false,
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

  it('continues HealthKit import when Calendar access is denied and never runs a calendar query', async () => {
    const base = createTestServices({
      calendar: {
        async requestAccessIfNeeded() {
          base.timeline.push('eventKit.denied');
          return 'denied';
        },
        async listUpcomingEvents() {
          throw new Error('query must not run without full access');
        },
      },
    });
    const coordinator = createUnifiedImportCoordinator(base.services);

    const result = await coordinator.start({
      healthKitFeatures: ['bodyMass'],
      calendar: true,
    }).result;

    expect(base.timeline).toContain('eventKit.denied');
    expect(result.progress.calendar.status).toBe('denied');
    expect(base.timeline).toContain('query:bodyMass');
    expect(base.timeline).not.toContain('eventKit.query');
    expect(result.status).toBe('partial');
  });

  it('still requests and reads Calendar after a HealthKit API failure', async () => {
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
      calendar: true,
    }).result;

    expect(base.timeline).toContain('eventKit.authorization');
    expect(base.timeline).toContain('eventKit.query');
    expect(result.progress.features.heartRate.status).toBe('failed');
    expect(result.progress.calendar.status).toBe('empty');
    expect(
      result.measurements.some(measurement =>
        JSON.stringify(measurement).includes('private failure detail'),
      ),
    ).toBe(false);
    expect(result.status).toBe('partial');
  });
});
