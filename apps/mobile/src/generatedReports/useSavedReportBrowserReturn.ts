import { useEffect, useLayoutEffect, useReducer, type RefObject } from 'react';
import { AppState } from 'react-native';
import type { GeneratedReportDetailPresentationState } from './GeneratedReportDetailPresentation';
import type { GeneratedReportCitationSelection } from './types';
import { watchSavedReportNativeProtection } from './savedReportNativeProtection';

type Target = GeneratedReportCitationSelection['target'];
type SourceScroll = {
  readonly preserve: () => void;
  readonly restore: () => void;
};
export type SavedReportSourceTrip = {
  phase: 'leaving' | 'covered' | 'returning' | 'restore';
  readonly target: Target;
} & (
  | { readonly surface: 'stack' }
  | {
      readonly surface: 'browser';
      readonly departBy: number;
      suspended: boolean;
    }
);
type TripRef = RefObject<SavedReportSourceTrip | undefined>;

// Never reuse an unrelated later app departure as proof of a browser trip.
const browserDepartureWindowMs = 2_000;

export function beginSavedReportBrowserTrip(
  sourceTrip: TripRef,
  target: Target,
  scroll: SourceScroll | null | undefined,
  invalidate: () => void,
) {
  const trip: SavedReportSourceTrip = {
    phase: 'leaving',
    surface: 'browser',
    target,
    departBy: performance.now() + browserDepartureWindowMs,
    suspended: false,
  };
  sourceTrip.current = trip;
  scroll?.preserve();
  return () => {
    if (sourceTrip.current !== trip) return;
    if (trip.phase === 'leaving' && !trip.suspended)
      sourceTrip.current = undefined;
    else invalidate();
  };
}

/** Called only when an explicit pull begins, never during render or on activation. */
export function hasCurrentSavedReportSourceTrip(sourceTrip: TripRef) {
  const trip = sourceTrip.current;
  if (
    trip?.surface === 'browser' &&
    trip.phase === 'leaving' &&
    !trip.suspended &&
    performance.now() > trip.departBy
  )
    sourceTrip.current = undefined;
  return Boolean(sourceTrip.current);
}

function useSavedReportBrowserReturn(
  sourceTrip: TripRef,
  started: RefObject<boolean>,
  invalidate: () => void,
) {
  const [revision, wake] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', appState => {
      const trip = sourceTrip.current;
      if (trip?.surface !== 'browser') return;
      if (trip.phase === 'leaving') {
        if (appState === 'background') {
          if (performance.now() > trip.departBy) invalidate();
          else trip.phase = 'covered';
        } else if (appState === 'active' && trip.suspended) {
          // Inactive-only interruption is not a browser handoff.
          invalidate();
        }
        return;
      }
      if (appState === 'active' && trip.phase === 'covered') {
        if (!trip.suspended) {
          invalidate();
          return;
        }
        trip.phase = 'returning';
        started.current = false;
        wake();
      }
    });
    return () => subscription.remove();
  }, [invalidate, sourceTrip, started]);
  return revision;
}

/** A browser return alone never authorizes a protected read. */
export function prepareSavedReportReturnRead(
  trip: SavedReportSourceTrip | undefined,
  signal: AbortSignal,
  current: () => boolean,
  invalidate: () => void,
) {
  if (trip?.surface !== 'browser' || trip.phase !== 'returning') return;
  const protection = watchSavedReportNativeProtection(signal, () => {
    if (current()) invalidate();
  });
  return {
    confirm: () => protection?.confirm() ?? false,
    dispose: () => protection?.dispose(),
  };
}

/** Preserve the existing one-level local source trip and either trip's scroll restoration. */
export function useSavedReportTrips(
  sourceTrip: TripRef,
  started: RefObject<boolean>,
  active: boolean,
  state: GeneratedReportDetailPresentationState,
  canAccess: () => boolean,
  scroll: SourceScroll | null | undefined,
  invalidate: () => void,
) {
  const revision = useSavedReportBrowserReturn(sourceTrip, started, invalidate);
  useLayoutEffect(() => {
    const trip = sourceTrip.current;
    if (trip?.surface !== 'stack') return;
    if (!active && trip?.phase === 'leaving') trip.phase = 'covered';
    if (active && trip?.phase === 'covered') {
      // Only this report's explicit source child may start another local read.
      // Never republish the previously open result without a new proof.
      trip.phase = 'returning';
      started.current = false;
    }
  }, [active, sourceTrip, started]);
  useLayoutEffect(() => {
    if (
      state.status === 'ready' &&
      sourceTrip.current?.phase === 'restore' &&
      canAccess()
    ) {
      sourceTrip.current = undefined;
      scroll?.restore();
    }
  }, [canAccess, scroll, sourceTrip, state]);
  return revision;
}
