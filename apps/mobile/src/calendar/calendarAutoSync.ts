import { AppState } from 'react-native';
import type {
  CalendarAccessState,
  CalendarBridge,
  CalendarEvent,
  CalendarQueryCoverage,
} from './types';

export interface CalendarAutoSyncState {
  readonly access: CalendarAccessState | null;
  readonly events: readonly CalendarEvent[];
  readonly query: CalendarQueryCoverage | null;
  readonly loading: boolean;
  readonly error: boolean;
  readonly updatedAt: string | null;
}

export const emptyCalendarAutoSyncState: CalendarAutoSyncState = {
  access: null,
  events: [],
  query: null,
  loading: false,
  error: false,
  updatedAt: null,
};

/**
 * Owns passive EventKit refreshes; it never requests permission or invokes an AI provider.
 * Settings and explicit classification actions remain the only permission request paths.
 */
export class CalendarAutoSyncController {
  private snapshot: CalendarAutoSyncState = emptyCalendarAutoSyncState;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private previousAppState: string | null | undefined = AppState.currentState;
  private eventSubscription: { remove: () => void } | undefined;
  private appStateSubscription: { remove: () => void } | undefined;
  private refreshIntent = 0;
  private refreshAgain = false;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly bridge: CalendarBridge) {}

  readonly getSnapshot = (): CalendarAutoSyncState => this.snapshot;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts launch sync and lifecycle observers once; repeated starts preserve one owner. */
  readonly start = (): Promise<void> => {
    if (this.started) return Promise.resolve();
    this.started = true;
    this.previousAppState = AppState.currentState;
    this.eventSubscription = this.bridge.addEventStoreListener(() => {
      void this.refresh();
    });
    this.appStateSubscription = AppState.addEventListener('change', state => {
      const returnedToForeground =
        (this.previousAppState === 'background' ||
          this.previousAppState === 'inactive') &&
        state === 'active';
      this.previousAppState = state;
      if (returnedToForeground) void this.refresh();
    });
    return this.refresh();
  };

  readonly stop = (): void => {
    if (!this.started) return;
    this.started = false;
    this.eventSubscription?.remove();
    this.appStateSubscription?.remove();
    this.eventSubscription = undefined;
    this.appStateSubscription = undefined;
    this.refreshAgain = false;
  };

  /**
   * Serializes event-change and foreground reads, discarding a snapshot when a newer trigger arrived.
   */
  readonly refresh = (): Promise<void> => {
    const listUpcomingEvents = this.bridge.listUpcomingEvents;
    if (!this.started || !listUpcomingEvents) {
      return Promise.resolve();
    }
    this.refreshIntent += 1;
    if (this.inFlight) {
      this.refreshAgain = true;
      return this.inFlight;
    }

    const run = async () => {
      do {
        this.refreshAgain = false;
        const queryIntent = this.refreshIntent;
        this.update({ ...this.snapshot, loading: true, error: false });
        try {
          const result = await listUpcomingEvents();
          // A later trigger makes this response stale; its queued read will publish the current view.
          if (this.started && queryIntent === this.refreshIntent) {
            this.update({
              ...this.snapshot,
              access: result.access,
              events: result.access === 'fullAccess' ? result.events : [],
              query:
                result.access === 'fullAccess' ? (result.query ?? null) : null,
              loading: false,
              error: false,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch {
          if (this.started && queryIntent === this.refreshIntent) {
            this.update({ ...this.snapshot, loading: false, error: true });
          }
        }
      } while (this.refreshAgain && this.started);
    };

    let currentPromise: Promise<void>;
    currentPromise = run().finally(() => {
      if (this.inFlight !== currentPromise) return;
      this.inFlight = null;
      // A trigger can arrive after the loop condition but before this promise settles.
      if (this.refreshAgain && this.started) {
        this.refreshAgain = false;
        void this.refresh();
      }
    });
    this.inFlight = currentPromise;
    return currentPromise;
  };

  /** Requests access only in response to a Settings action, then reads after the system reply. */
  readonly requestAccess = async (): Promise<CalendarAccessState | null> => {
    if (!this.bridge.requestEventAccess) {
      this.update({ ...this.snapshot, loading: false, error: true });
      return null;
    }
    try {
      const access = await this.bridge.requestEventAccess();
      this.update({
        ...this.snapshot,
        access,
        events: access === 'fullAccess' ? this.snapshot.events : [],
        query: access === 'fullAccess' ? this.snapshot.query : null,
        error: false,
      });
      await this.refresh();
      return access;
    } catch {
      this.update({ ...this.snapshot, loading: false, error: true });
      return null;
    }
  };

  private update(next: CalendarAutoSyncState): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
