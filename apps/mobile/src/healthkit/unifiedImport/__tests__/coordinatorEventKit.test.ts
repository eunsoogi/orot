import { createUnifiedImportCoordinator } from '../coordinator';
import { createTestServices } from '../testSupport';
import type { UnifiedFeatureOutcome } from '../types';

describe('unified EventKit provider outcomes', () => {
  it('supports an EventKit-only selection without opening HealthKit storage', async () => {
    const base = createTestServices();
    const healthKitRequest = jest.fn(
      base.services.healthKit.requestReadAuthorizations,
    );
    const openRepository = jest.fn(base.services.openRepository);
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: { requestReadAuthorizations: healthKitRequest },
      openRepository,
    });

    const result = await coordinator.start({
      healthKitFeatures: [],
      eventKit: true,
    }).result;

    expect(result.status).toBe('complete');
    expect(result.progress.eventKit.candidates).toHaveLength(1);
    expect(healthKitRequest).not.toHaveBeenCalled();
    expect(openRepository).not.toHaveBeenCalled();
    expect(base.timeline).toEqual(['eventKit.authorization', 'eventKit.query']);
  });

  it('queries EventKit when the selected HealthKit request fails', async () => {
    const base = createTestServices();
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: {
        async requestReadAuthorizations() {
          throw new Error('private HealthKit failure');
        },
      },
    });

    const result = await coordinator.start({
      healthKitFeatures: ['heartRate'],
      eventKit: true,
    }).result;

    expect(result.progress.features.heartRate.status).toBe('failed');
    expect(result.progress.eventKit.status).toBe('complete');
    expect(result.progress.eventKit.candidates).toHaveLength(1);
    expect(base.timeline).toContain('eventKit.query');
    expect(result.status).toBe('partial');
  });

  it('keeps HealthKit outcomes when the EventKit query fails', async () => {
    const base = createTestServices();
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      eventKit: {
        async requestEventAccess() {
          return 'fullAccess';
        },
        async listUpcomingEvents() {
          throw new Error('private EventKit failure');
        },
      },
    });

    const result = await coordinator.start({
      healthKitFeatures: ['heartRate'],
      eventKit: true,
    }).result;

    expect(result.progress.features.heartRate.status).toBe('complete');
    expect(result.progress.eventKit.status).toBe('failed');
    expect(result.progress.eventKit.candidates).toHaveLength(0);
    expect(result.status).toBe('partial');
    expect(
      JSON.stringify(result.measurements).includes('private EventKit failure'),
    ).toBe(false);
  });

  it('clears calendar candidates when the selected import is cancelled mid-feature', async () => {
    const base = createTestServices();
    let signalFeatureStarted: () => void = () => undefined;
    const featureStarted = new Promise<void>(resolve => {
      signalFeatureStarted = resolve;
    });
    let finishFeature: (outcome: UnifiedFeatureOutcome) => void = () =>
      undefined;
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      async runFeature() {
        signalFeatureStarted();
        return new Promise(resolve => {
          finishFeature = resolve;
        });
      },
    });

    const run = coordinator.start({
      healthKitFeatures: ['heartRate'],
      eventKit: true,
    });
    await featureStarted;
    run.cancel();
    finishFeature({ status: 'complete', importedCount: 0, deletedCount: 0 });

    const result = await run.result;
    expect(result.status).toBe('cancelled');
    expect(result.progress.eventKit.status).toBe('cancelled');
    expect(result.progress.eventKit.candidates).toEqual([]);
    await expect(run.confirmCalendarEvent(base.calendarEvent)).rejects.toThrow(
      'Calendar candidate is not available.',
    );
  });

  it('allows only one calendar persistence while confirmation is in flight', async () => {
    const base = createTestServices();
    let finishConfirmation: () => void = () => undefined;
    const persistence = new Promise<void>(resolve => {
      finishConfirmation = resolve;
    });
    const confirmCalendarEvent = jest.fn(() => persistence);
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      confirmCalendarEvent,
    });
    const run = coordinator.start({ healthKitFeatures: [], eventKit: true });
    await run.result;

    const firstConfirmation = run.confirmCalendarEvent(base.calendarEvent);
    await expect(run.confirmCalendarEvent(base.calendarEvent)).rejects.toThrow(
      'Calendar candidate was already confirmed.',
    );
    finishConfirmation();
    await firstConfirmation;

    expect(confirmCalendarEvent).toHaveBeenCalledTimes(1);
  });
});
