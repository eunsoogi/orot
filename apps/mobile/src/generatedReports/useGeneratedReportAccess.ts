import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';

/** Observe ownership directly: controller Back can end access before focus rerenders. */
export function useGeneratedReportAccess(
  active: boolean,
  ownership: NavigationRouteOwnership | undefined,
  invalidate: () => void,
  abort: () => void,
) {
  const live = useRef({ active, ownership });
  live.current = { active, ownership };
  const foreground = useRef(AppState.currentState === 'active');
  const [accessVersion, wake] = useReducer((version: number) => version + 1, 0);
  const canAccess = useCallback(
    () =>
      live.current.active &&
      foreground.current &&
      AppState.currentState === 'active' &&
      (live.current.ownership?.isCurrent() ?? true),
    [],
  );

  useLayoutEffect(() => {
    foreground.current = AppState.currentState === 'active';
    // Old rows cannot survive replacement of the route's ownership object.
    invalidate();
    let ready = canAccess();
    const sync = () => {
      const next = canAccess();
      if (ready === next) return;
      ready = next;
      if (!next) invalidate();
      wake();
    };
    const leave = ownership?.subscribe(sync);
    const clear = subscribeLocalDataClear(invalidate);
    const deleted = subscribeLocalSourceDeletion(invalidate);
    const appState = AppState.addEventListener('change', value => {
      foreground.current = value === 'active';
      sync();
    });
    return () => {
      abort();
      leave?.();
      clear();
      deleted();
      appState.remove();
    };
  }, [abort, active, canAccess, invalidate, ownership]);

  return { accessVersion, canAccess };
}
