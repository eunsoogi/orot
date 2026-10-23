import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { CalendarBridge } from './types';
import {
  CalendarAutoSyncController,
  type CalendarAutoSyncState,
} from './calendarAutoSync';

export interface CalendarAutoSyncActions extends CalendarAutoSyncState {
  readonly refresh: () => Promise<void>;
  readonly requestAccess: () => Promise<
    import('./types').CalendarAccessState | null
  >;
}

/** Connects the shared EventKit sync owner to React without starting a second listener per screen. */
export function useCalendarAutoSync(
  bridge: CalendarBridge,
): CalendarAutoSyncActions {
  const controller = useMemo(
    () => new CalendarAutoSyncController(bridge),
    [bridge],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);

  return {
    ...snapshot,
    refresh: controller.refresh,
    requestAccess: controller.requestAccess,
  };
}
