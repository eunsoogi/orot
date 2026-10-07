import type { CalendarEvent } from '../../calendar/types';
import type { UnifiedImportServices } from './types';
import type { ActiveRun } from './coordinatorProgress';
import { measure } from './coordinatorMeasurements';
import {
  recordMeasurement,
  setEventKit,
  setPhase,
} from './coordinatorProgress';

export async function authorizeEventKit(
  run: ActiveRun,
  services: UnifiedImportServices,
  now: () => number,
): Promise<void> {
  if (!run.selection.eventKit) return;
  setPhase(run, 'authorizingEventKit');
  setEventKit(run, { status: 'authorizing' });
  try {
    const access = await measure(
      run,
      'eventKit',
      'authorization',
      () => {
        // This marks the bridge call, not visibility of an OS consent sheet.
        recordMeasurement(
          run,
          {
            provider: 'eventKit',
            phase: 'permissionRequestInvocation',
            transition: 'invoked',
          },
          now,
        );
        return services.eventKit.requestEventAccess();
      },
      now,
    );
    setEventKit(run, {
      status: access === 'fullAccess' ? 'ready' : access,
      access,
    });
  } catch {
    setEventKit(run, { status: 'failed' });
  }
}

export async function queryEventKit(
  run: ActiveRun,
  services: UnifiedImportServices,
  now: () => number,
): Promise<void> {
  if (
    !run.selection.eventKit ||
    run.progress.eventKit.access !== 'fullAccess'
  ) {
    return;
  }
  if (run.cancelled) {
    setEventKit(run, { status: 'cancelled', candidates: [] });
    return;
  }
  setPhase(run, 'queryingEventKit');
  setEventKit(run, { status: 'querying' });
  try {
    const result = await measure(
      run,
      'eventKit',
      'query',
      () => services.eventKit.listUpcomingEvents(),
      now,
    );
    if (run.cancelled) {
      setEventKit(run, { status: 'cancelled', candidates: [] });
      return;
    }
    const candidates = result.access === 'fullAccess' ? result.events : [];
    setEventKit(run, {
      status:
        result.access === 'fullAccess'
          ? candidates.length > 0
            ? 'complete'
            : 'empty'
          : result.access,
      access: result.access,
      candidates,
    });
  } catch {
    setEventKit(run, { status: 'failed', candidates: [] });
  }
}

export function confirmCalendarCandidate(
  run: ActiveRun,
  event: CalendarEvent,
  services: UnifiedImportServices,
  now: () => number,
): Promise<void> {
  const candidate = run.progress.eventKit.candidates.find(
    item => eventKey(item) === eventKey(event),
  );
  if (
    !run.finished ||
    run.cancelled ||
    !run.selection.eventKit ||
    run.progress.eventKit.access !== 'fullAccess' ||
    !candidate
  ) {
    return Promise.reject(new Error('Calendar candidate is not available.'));
  }
  if (run.eventConfirmationInProgress || run.eventConfirmationComplete) {
    return Promise.reject(
      new Error('Calendar candidate was already confirmed.'),
    );
  }

  run.eventConfirmationInProgress = true;
  return measure(
    run,
    'localStore',
    'persistence',
    () => services.confirmCalendarEvent(candidate),
    now,
  )
    .then(() => {
      run.eventConfirmationComplete = true;
      setEventKit(run, {
        status: run.progress.eventKit.status,
        appointmentConfirmed: true,
      });
    })
    .finally(() => {
      run.eventConfirmationInProgress = false;
    });
}

function eventKey(event: CalendarEvent): string {
  const snapshot = event.calendarEventSnapshot;
  // Event identity stays in memory for candidate validation and never enters measurements.
  const occurrence =
    snapshot.occurrenceDate ??
    snapshot.floatingOccurrenceAt ??
    event.effectiveAt;
  return `${event.calendarEventIdentifier}\u0000${occurrence}`;
}
