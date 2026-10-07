import type { UnifiedFeatureOutcome } from '../types';
import { createUnifiedImportCoordinator } from '../coordinator';
import { availableBatch, createTestServices, deferred } from '../testSupport';

describe('unified import re-entry and cancellation', () => {
  it('coalesces identical selected-provider runs and replays current progress', async () => {
    const base = createTestServices();
    const authorization = deferred<ReturnType<typeof availableBatch>>();
    const requestReadAuthorizations = jest.fn(() => authorization.promise);
    const requestEventAccess = jest.fn(
      base.services.eventKit.requestEventAccess,
    );
    const listUpcomingEvents = jest.fn(
      base.services.eventKit.listUpcomingEvents,
    );
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: { requestReadAuthorizations },
      eventKit: { requestEventAccess, listUpcomingEvents },
    });
    const selection = {
      healthKitFeatures: ['heartRate'] as const,
      eventKit: true,
    };
    const first = coordinator.start(selection);
    const replayed = jest.fn();
    const second = coordinator.start(selection, { onProgress: replayed });
    expect(second).toBe(first);
    expect(replayed).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'queued' }),
    );

    await Promise.resolve();
    authorization.resolve(availableBatch(['heartRate']));
    const result = await first.result;

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(requestEventAccess).toHaveBeenCalledTimes(1);
    expect(listUpcomingEvents).toHaveBeenCalledTimes(1);
    expect(replayed).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.objectContaining({
          heartRate: expect.objectContaining({ status: 'complete' }),
        }),
      }),
    );
    expect(result.progress.features.heartRate.status).toBe('complete');
    expect(result.progress.eventKit.status).toBe('complete');
  });

  it('serializes different selections to keep HealthKit prompts and cursor writes from racing', async () => {
    const base = createTestServices();
    const firstFeature = deferred<UnifiedFeatureOutcome>();
    const firstEntered = deferred<void>();
    const requestReadAuthorizations = jest.fn(
      base.services.healthKit.requestReadAuthorizations,
    );
    const runFeature = jest.fn(
      async (...args: Parameters<typeof base.services.runFeature>) => {
        if (args[0] === 'heartRate') {
          firstEntered.resolve();
          return firstFeature.promise;
        }
        return base.services.runFeature(...args);
      },
    );
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: { requestReadAuthorizations },
      runFeature,
    });
    const first = coordinator.start({
      healthKitFeatures: ['heartRate'],
    });
    await firstEntered.promise;
    const second = coordinator.start({
      healthKitFeatures: ['steps'],
    });
    await Promise.resolve();

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(base.timeline).not.toContain('feature:steps');
    firstFeature.resolve({
      status: 'complete',
      importedCount: 1,
      deletedCount: 0,
    });
    await Promise.all([first.result, second.result]);

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(2);
    expect(base.timeline.indexOf('feature:heartRate')).toBeLessThan(
      base.timeline.indexOf('feature:steps'),
    );
  });

  it('keeps an EventKit selection distinct from the same HealthKit-only selection', async () => {
    const base = createTestServices();
    const authorization = deferred<ReturnType<typeof availableBatch>>();
    const requestReadAuthorizations = jest.fn(() => authorization.promise);
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      healthKit: { requestReadAuthorizations },
    });
    const healthKitOnly = coordinator.start({
      healthKitFeatures: ['heartRate'],
    });
    const withEventKit = coordinator.start({
      healthKitFeatures: ['heartRate'],
      eventKit: true,
    });

    expect(withEventKit).not.toBe(healthKitOnly);
    authorization.resolve(availableBatch(['heartRate']));
    const [healthKitResult, combinedResult] = await Promise.all([
      healthKitOnly.result,
      withEventKit.result,
    ]);

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(2);
    expect(healthKitResult.progress.eventKit.status).toBe('notSelected');
    expect(combinedResult.progress.eventKit.status).toBe('complete');
  });

  it('finishes the active feature and marks later features cancelled without starting them', async () => {
    const base = createTestServices();
    const firstFeature = deferred<UnifiedFeatureOutcome>();
    const firstEntered = deferred<void>();
    const runFeature = jest.fn(
      async (...args: Parameters<typeof base.services.runFeature>) => {
        if (args[0] === 'heartRate') {
          firstEntered.resolve();
          return firstFeature.promise;
        }
        return base.services.runFeature(...args);
      },
    );
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      runFeature,
    });
    const run = coordinator.start({
      healthKitFeatures: ['heartRate', 'steps'],
    });
    await firstEntered.promise;
    run.cancel();
    firstFeature.resolve({
      status: 'complete',
      importedCount: 1,
      deletedCount: 0,
    });

    const result = await run.result;

    expect(runFeature).toHaveBeenCalledTimes(1);
    expect(result.progress.features.heartRate.status).toBe('complete');
    expect(result.progress.features.steps.status).toBe('cancelled');
    expect(result.status).toBe('cancelled');
  });

  it('allows an explicit retry after a feature fails', async () => {
    const base = createTestServices();
    let attempts = 0;
    const runFeature = jest.fn(
      async (...args: Parameters<typeof base.services.runFeature>) => {
        attempts += 1;
        if (attempts === 1) throw new Error('private query failure');
        return base.services.runFeature(...args);
      },
    );
    const coordinator = createUnifiedImportCoordinator({
      ...base.services,
      runFeature,
    });
    const selection = {
      healthKitFeatures: ['bodyMass'] as const,
    };

    const failed = await coordinator.start(selection).result;
    const retried = await coordinator.start(selection).result;

    expect(failed.progress.features.bodyMass.status).toBe('failed');
    expect(retried.progress.features.bodyMass.status).toBe('complete');
    expect(runFeature).toHaveBeenCalledTimes(2);
  });
});
