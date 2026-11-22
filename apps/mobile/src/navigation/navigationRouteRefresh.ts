import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

type Refresh = () => Promise<void>;
type RegisterRefresh = (refresh: Refresh) => () => void;

export const NavigationRouteRefreshContext =
  createContext<RegisterRefresh | null>(null);

/** Bind a route-owned read to the existing scroll host, not to a second ScrollView. */
export function useNavigationRouteRefresh(enabled: boolean, refresh: Refresh) {
  const register = useContext(NavigationRouteRefreshContext);
  const latest = useRef(refresh);
  latest.current = refresh;
  useLayoutEffect(
    () => (enabled ? register?.(() => latest.current()) : undefined),
    [enabled, register],
  );
}

export function useNavigationRouteRefreshHost() {
  const [refreshing, setRefreshing] = useState(false);
  const owner = useRef<Refresh | null>(null);
  const pending = useRef<Refresh | null>(null);
  const register = useCallback<RegisterRefresh>(refresh => {
    owner.current = refresh;
    return () => {
      if (owner.current !== refresh) return;
      owner.current = null;
      if (pending.current !== refresh) return;
      pending.current = null;
      setRefreshing(false);
    };
  }, []);
  const onRefresh = useCallback(async () => {
    const refresh = owner.current;
    if (!refresh || pending.current) return;
    pending.current = refresh;
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      // Feed failures remain visible through the existing manual Retry affordance.
    } finally {
      if (pending.current === refresh) {
        pending.current = null;
        setRefreshing(false);
      }
    }
  }, []);
  return { register, refreshing, onRefresh };
}
