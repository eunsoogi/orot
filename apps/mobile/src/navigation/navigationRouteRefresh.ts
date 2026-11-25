import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AppState, NativeModules, Platform } from 'react-native';

type Refresh = (acceptGesture: () => void) => Promise<void>;
type RegisterRefresh = (refresh: Refresh) => () => void;

function refreshImpact() {
  if (Platform.OS !== 'ios' || AppState.currentState !== 'active') return;
  try {
    NativeModules.RouteRefreshFeedbackModule?.didAcceptPull?.();
  } catch {
    // An unavailable tactile cue must never interrupt the refresh.
  }
}

export const NavigationRouteRefreshContext =
  createContext<RegisterRefresh | null>(null);

/** Bind a route-owned read to the existing scroll host, not to a second ScrollView. */
export function useNavigationRouteRefresh(enabled: boolean, refresh: Refresh) {
  const register = useContext(NavigationRouteRefreshContext);
  const latest = useRef(refresh);
  latest.current = refresh;
  useLayoutEffect(
    () =>
      enabled
        ? register?.(acceptGesture => latest.current(acceptGesture))
        : undefined,
    [enabled, register],
  );
}

export function useNavigationRouteRefreshHost() {
  const [refreshing, setRefreshing] = useState(false);
  const owner = useRef<Refresh | null>(null);
  const pending = useRef<{ refresh: Refresh } | null>(null);
  const register = useCallback<RegisterRefresh>(refresh => {
    owner.current = refresh;
    return () => {
      if (owner.current !== refresh) return;
      owner.current = null;
      if (pending.current?.refresh !== refresh) return;
      pending.current = null;
      setRefreshing(false);
    };
  }, []);
  const onRefresh = useCallback(async () => {
    const refresh = owner.current;
    if (!refresh || pending.current) return;
    const operation = { refresh };
    pending.current = operation;
    setRefreshing(true);
    try {
      let accepted = false;
      await refresh(() => {
        if (
          accepted ||
          owner.current !== refresh ||
          pending.current !== operation
        )
          return;
        accepted = true;
        refreshImpact();
      });
    } catch {
      // Feed failures remain visible through the existing manual Retry affordance.
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        setRefreshing(false);
      }
    }
  }, []);
  return { register, refreshing, onRefresh };
}
