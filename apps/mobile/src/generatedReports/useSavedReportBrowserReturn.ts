import { useEffect, useReducer, type RefObject } from 'react';
import { AppState } from 'react-native';
import type { GeneratedReportCitationSelection } from './types';

export type SavedReportSourceTrip = {
  phase: 'leaving' | 'covered' | 'returning' | 'restore';
  readonly target: GeneratedReportCitationSelection['target'];
} & (
  | { readonly surface: 'stack' }
  | { readonly surface: 'browser'; readonly departBy: number }
);

// Link completion ordering and AppState delivery vary. Accept a prompt native
// handoff, never interpret a later ordinary app departure as this source trip.
const browserDepartureWindowMs = 2_000;
export const savedReportBrowserDepartureDeadline = () =>
  performance.now() + browserDepartureWindowMs;

export function useSavedReportBrowserReturn(
  sourceTrip: RefObject<SavedReportSourceTrip | undefined>,
  started: RefObject<boolean>,
) {
  const [revision, wake] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', appState => {
      const trip = sourceTrip.current;
      if (trip?.surface !== 'browser') return;
      if (trip.phase === 'leaving') {
        if (performance.now() > trip.departBy) sourceTrip.current = undefined;
        else if (appState !== 'active') trip.phase = 'covered';
        return;
      }
      if (appState === 'active' && trip.phase === 'covered') {
        // The protected reader will prove this same lease again after activation.
        trip.phase = 'returning';
        started.current = false;
        wake();
      }
    });
    return () => subscription.remove();
  }, [sourceTrip, started]);
  return revision;
}
