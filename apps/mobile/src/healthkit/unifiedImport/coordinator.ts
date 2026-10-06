import type { HealthKitBatchAuthorizationResult } from '../types';
import type {
  UnifiedCalendarStatus,
  UnifiedImportListeners,
  UnifiedImportRun,
  UnifiedImportSelection,
  UnifiedImportServices,
} from './types';
import {
  attachListeners,
  createRun,
  makeResult,
  recordMeasurement,
  setCalendar,
  setFeature,
  setPhase,
} from './coordinatorProgress';
import type { ActiveRun } from './coordinatorProgress';
import { featureInstrumentation, measure } from './coordinatorMeasurements';
import {
  applyBatchResult,
  authorizationForFeature,
  cancelRemaining,
  failUnfinished,
  finish,
  normalizeSelection,
  requestCancel,
} from './coordinatorOutcomes';

/** Queues re-entry and completes both consent APIs before opening local storage. */
export function createUnifiedImportCoordinator(
  services: UnifiedImportServices,
) {
  let queue = Promise.resolve();
  const inFlight = new Map<string, ActiveRun>();
  const now = services.monotonicNow ?? defaultMonotonicNow;

  function start(
    selection: UnifiedImportSelection,
    listeners: UnifiedImportListeners = {},
  ): UnifiedImportRun {
    const normalized = normalizeSelection(selection);
    const key = `${normalized.healthKitFeatures.join(',')}|calendar:${normalized.calendar}`;
    const existing = inFlight.get(key);
    if (existing) {
      attachListeners(existing, listeners);
      if (existing.handle) return existing.handle;
      throw new Error('Unified import was registered before its run handle.');
    }

    const run = createRun(normalized, key, now());
    const operation = queue.then(() => execute(run));
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    const result = operation.then(
      () => makeResult(run),
      () => {
        failUnfinished(run);
        return makeResult(run);
      },
    );
    const handle = { result, cancel: () => requestCancel(run) };
    run.handle = handle;
    inFlight.set(key, run);
    attachListeners(run, listeners);
    result.then(() => {
      if (inFlight.get(key) === run) inFlight.delete(key);
    });
    return handle;
  }

  async function execute(run: ActiveRun): Promise<void> {
    if (run.cancelled) return cancelUnstarted(run);
    let batch: HealthKitBatchAuthorizationResult | null = null;
    if (run.selection.healthKitFeatures.length > 0) {
      setPhase(run, 'authorizingHealthKit');
      try {
        batch = await measure(
          run,
          'healthKit',
          'authorization',
          () =>
            services.healthKit.requestReadAuthorizations(
              run.selection.healthKitFeatures,
            ),
          now,
        );
        applyBatchResult(run, batch);
      } catch {
        for (const feature of run.selection.healthKitFeatures) {
          setFeature(run, feature, { status: 'failed' });
        }
      }
    }

    if (run.selection.calendar && !run.cancelled) {
      setPhase(run, 'authorizingEventKit');
      recordMeasurement(
        run,
        {
          provider: 'eventKit',
          phase: 'permissionRequestInvocation',
          transition: 'invoked',
        },
        now,
      );
      try {
        const access = await measure(
          run,
          'eventKit',
          'authorization',
          () => services.calendar.requestAccessIfNeeded(),
          now,
        );
        setCalendar(run, { status: access });
      } catch {
        setCalendar(run, { status: 'failed' });
      }
    }
    if (run.cancelled) return cancelUnstarted(run);

    if (run.progress.calendar.status === 'fullAccess') {
      setPhase(run, 'querying');
      setCalendar(run, { status: 'querying' });
      try {
        const upcoming = await measure(
          run,
          'eventKit',
          'query',
          () => services.calendar.listUpcomingEvents(),
          now,
        );
        setCalendar(run, {
          status: calendarStatus(upcoming.access, upcoming.events.length),
          eventCount:
            upcoming.access === 'fullAccess' ? upcoming.events.length : null,
        });
      } catch {
        setCalendar(run, { status: 'failed' });
      }
    }
    if (run.cancelled) return cancelUnstarted(run);

    const readyFeatures = run.selection.healthKitFeatures.filter(
      feature => run.progress.features[feature].status === 'ready',
    );
    if (readyFeatures.length === 0) return finish(run);

    let repository;
    setPhase(run, 'preparingStorage');
    try {
      // Database initialization may migrate storage, so it follows both providers' consent calls.
      repository = await measure(
        run,
        'localStore',
        'persistence',
        services.openRepository,
        now,
      );
    } catch {
      for (const feature of readyFeatures) {
        setFeature(run, feature, { status: 'failed' });
      }
      return finish(run);
    }

    setPhase(run, 'querying');
    for (const feature of readyFeatures) {
      if (run.cancelled) {
        setFeature(run, feature, { status: 'cancelled' });
        continue;
      }
      setFeature(run, feature, { status: 'querying' });
      try {
        const outcome = await services.runFeature(
          feature,
          authorizationForFeature(batch, feature),
          repository,
          featureInstrumentation(run, feature, now),
        );
        setFeature(run, feature, outcome);
      } catch {
        setFeature(run, feature, { status: 'failed' });
      }
    }
    if (run.cancelled) cancelRemaining(run);
    finish(run);
  }

  function cancelUnstarted(run: ActiveRun): void {
    cancelRemaining(run);
    finish(run);
  }

  return { start };
}

function calendarStatus(
  access:
    'fullAccess' | 'writeOnly' | 'notDetermined' | 'denied' | 'restricted',
  eventCount: number,
): UnifiedCalendarStatus {
  if (access !== 'fullAccess') return access;
  return eventCount === 0 ? 'empty' : 'complete';
}

function defaultMonotonicNow(): number {
  return globalThis.performance.now();
}
