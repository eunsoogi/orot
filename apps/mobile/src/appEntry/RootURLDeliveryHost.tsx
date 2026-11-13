import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { AppRootTab } from '../navigation/rootTabs';
import type { createEntryArbiter } from './entryArbiter';
import { createRootURLDelivery } from './rootURLDelivery';
import { rootURLBridge } from './rootURLBridge';

/** Mount-time peek and subsequent wakes drain the same durable native inbox. */
export function RootURLDeliveryHost({
  controller,
  arbiter,
  ready,
  canEnter,
  selectTab,
  onApplied,
  onSettled,
}: {
  controller: NavigationController<AppNavigationRoute>;
  arbiter: ReturnType<typeof createEntryArbiter>;
  ready: boolean;
  canEnter: () => boolean;
  selectTab: (tab: AppRootTab) => void;
  onApplied?: () => void;
  onSettled?: () => void;
}) {
  const current = useRef({ ready, canEnter, selectTab, onApplied, onSettled });
  current.current = { ready, canEnter, selectTab, onApplied, onSettled };
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    let mounted = true;
    let ownGuard = false;
    const deliver = createRootURLDelivery({
      arbiter,
      controller,
      ...rootURLBridge,
      canEnter: () =>
        mounted &&
        current.current.ready &&
        current.current.canEnter() &&
        AppState.currentState === 'active',
      selectTab: tab => {
        current.current.selectTab(tab);
        current.current.onApplied?.();
      },
      onGuardChange: active => {
        ownGuard = active;
      },
    });
    let running = false;
    let pendingWake = false;
    let snapshot = controller.getSnapshot();
    let routeKeys = snapshot.routes.map(route => route.key).join('|');
    let transitioning = snapshot.isTransitioning;
    const drain = () => {
      if (!mounted) return;
      if (running) {
        pendingWake = true;
        return;
      }
      running = true;
      deliver()
        .then(result => {
          if (result === 'opened' || result === 'cancelled') {
            current.current.onSettled?.();
            pendingWake = true;
          }
        })
        .catch(() => undefined)
        .finally(() => {
          running = false;
          if (pendingWake) {
            pendingWake = false;
            drain();
          }
        });
    };
    wake.current = drain;
    let unsubscribe = () => {};
    try {
      unsubscribe = rootURLBridge.subscribe(drain);
    } catch {
      /* A later lifecycle wake retries the native inbox. */
    }
    const lifecycle = AppState.addEventListener('change', state => {
      if (state === 'active') drain();
    });
    const navigation = controller.subscribe(() => {
      snapshot = controller.getSnapshot();
      const next = snapshot.routes.map(route => route.key).join('|');
      const changed = next !== routeKeys;
      const settled = transitioning && !snapshot.isTransitioning;
      routeKeys = next;
      transitioning = snapshot.isTransitioning;
      if (changed || (settled && !ownGuard)) drain();
    });
    drain();
    return () => {
      mounted = false;
      wake.current = () => {};
      unsubscribe();
      lifecycle.remove();
      navigation();
    };
  }, [arbiter, controller]);
  useEffect(() => {
    if (ready) wake.current();
  }, [ready]);
  return null;
}
