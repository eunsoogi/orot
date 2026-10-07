import { createUnifiedImportCoordinator } from '../coordinator';
import { createTestServices } from '../testSupport';

describe('selected provider ordering', () => {
  it('finishes selected provider authorization before querying either provider', async () => {
    const base = createTestServices();
    const coordinator = createUnifiedImportCoordinator(base.services);
    const result = await coordinator.start({
      healthKitFeatures: ['heartRate'],
      eventKit: true,
    }).result;

    const healthKitAuthorization = base.timeline.indexOf(
      'healthKit.authorization:heartRate',
    );
    const eventKitAuthorization = base.timeline.indexOf(
      'eventKit.authorization',
    );
    const eventKitQuery = base.timeline.indexOf('eventKit.query');
    const healthKitQuery = base.timeline.indexOf('query:heartRate');
    expect(healthKitAuthorization).toBeLessThan(eventKitQuery);
    expect(eventKitAuthorization).toBeLessThan(eventKitQuery);
    expect(eventKitAuthorization).toBeLessThan(healthKitQuery);
    expect(result.progress.eventKit.status).toBe('complete');
    expect(result.progress.eventKit.candidates).toHaveLength(1);
    const authorizationStarted = result.measurements.find(
      measurement =>
        measurement.provider === 'eventKit' &&
        measurement.phase === 'authorization' &&
        measurement.transition === 'started',
    );
    const permissionRequestInvoked = result.measurements.find(
      measurement =>
        measurement.provider === 'eventKit' &&
        measurement.phase === 'permissionRequestInvocation',
    );
    const authorizationFinished = result.measurements.find(
      measurement =>
        measurement.provider === 'eventKit' &&
        measurement.phase === 'authorization' &&
        measurement.transition === 'finished',
    );
    const eventKitQueryStarted = result.measurements.find(
      measurement =>
        measurement.provider === 'eventKit' &&
        measurement.phase === 'query' &&
        measurement.transition === 'started',
    );
    expect(authorizationStarted?.offsetMs).toBeLessThanOrEqual(
      permissionRequestInvoked?.offsetMs ?? -1,
    );
    expect(permissionRequestInvoked?.offsetMs).toBeLessThanOrEqual(
      authorizationFinished?.offsetMs ?? -1,
    );
    expect(eventKitQueryStarted?.offsetMs).toBeGreaterThanOrEqual(
      authorizationFinished?.offsetMs ?? Infinity,
    );
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'eventKit',
          phase: 'authorization',
        }),
        expect.objectContaining({ provider: 'eventKit', phase: 'query' }),
      ]),
    );
  });

  it('keeps HealthKit results when EventKit access is denied', async () => {
    const base = createTestServices();
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      eventKit: {
        async requestEventAccess() {
          base.timeline.push('eventKit.authorization');
          return 'denied';
        },
        async listUpcomingEvents() {
          base.timeline.push('eventKit.query');
          return { access: 'denied', events: [] };
        },
      },
    });

    const result = await coordinator.start({
      healthKitFeatures: ['heartRate'],
      eventKit: true,
    }).result;

    expect(result.progress.features.heartRate.status).toBe('complete');
    expect(result.progress.eventKit.status).toBe('denied');
    expect(result.status).toBe('partial');
    expect(base.timeline).not.toContain('eventKit.query');
  });
});
