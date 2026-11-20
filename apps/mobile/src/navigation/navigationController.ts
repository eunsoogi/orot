import type {
  NavigationController,
  NavigationIntent,
  NavigationLeaveGuard,
  NavigationRoute,
  NavigationSnapshot,
} from './navigationControllerTypes';
export type * from './navigationControllerTypes';

function createRoute<Name extends string>(
  name: Name,
  sequence: number,
): NavigationRoute<Name> {
  return { key: 'route-' + sequence, name };
}

function createSnapshot<Name extends string>(
  routes: readonly NavigationRoute<Name>[],
  isTransitioning: boolean,
): NavigationSnapshot<Name> {
  const currentRoute = routes[routes.length - 1];
  if (!currentRoute) throw new Error('Navigation requires a root route.');

  return {
    routes,
    currentRoute,
    canGoBack: routes.length > 1,
    isTransitioning,
  };
}

export function createNavigationController<Name extends string>(
  initialRoute: Name,
): NavigationController<Name> {
  const listeners = new Set<() => void>();
  const availabilityListeners = new Set<() => void>();
  const leaveStateAvailability = new Map<string, boolean>();
  const leaveGuards = new Map<string, NavigationLeaveGuard<Name>>();
  let sequence = 1;
  let routes: readonly NavigationRoute<Name>[] = [
    createRoute(initialRoute, sequence),
  ];
  let isTransitioning = false;
  let snapshot = createSnapshot(routes, isTransitioning);
  let approvalRevision = 0;
  let approvedRoot: { key: string; revision: number } | null = null;
  // Guard/state changes invalidate even when the route key stays unchanged.
  function invalidateApproval() {
    approvalRevision += 1;
    approvedRoot = null;
  }
  let availabilityKey = '';
  let availabilityScheduled = false;

  // Coalesce React cleanup/register pairs and signal only newly available owners.
  function updateAvailability() {
    if (availabilityScheduled) return;
    availabilityScheduled = true;
    Promise.resolve().then(() => {
      availabilityScheduled = false;
      const key = snapshot.currentRoute.key;
      const ready =
        leaveGuards.has(key) && leaveStateAvailability.get(key) === true;
      const next = ready ? key : '';
      const becameReady = !!next && next !== availabilityKey;
      availabilityKey = next;
      if (becameReady) availabilityListeners.forEach(listener => listener());
    });
  }

  function publish() {
    snapshot = createSnapshot(routes, isTransitioning);
    listeners.forEach(listener => listener());
    updateAvailability();
  }

  function addRoute(name: Name, replaceCurrent: boolean) {
    if (isTransitioning) return null;
    invalidateApproval();
    sequence += 1;
    const route = createRoute(name, sequence);
    if (replaceCurrent) {
      const replacedRoute = routes[routes.length - 1];
      if (replacedRoute) leaveGuards.delete(replacedRoute.key);
    }
    routes = replaceCurrent
      ? [...routes.slice(0, -1), route]
      : [...routes, route];
    publish();
    return route;
  }

  async function requestLeave(intent: NavigationIntent): Promise<boolean> {
    if (isTransitioning || routes.length < 2) return false;

    const from = routes[routes.length - 1];
    const root = routes[0];
    const to = intent === 'home' ? root : routes[routes.length - 2];
    if (!from || !to) return false;

    invalidateApproval();
    isTransitioning = true;
    publish();
    try {
      const guard = leaveGuards.get(from.key);
      // A route without a live state owner cannot prove that leaving is safe.
      if (!guard) return false;
      const allowed = await guard({ intent, from, to });
      if (!allowed) return false;

      const removedRoutes = intent === 'home' ? routes.slice(1) : [from];
      routes = intent === 'home' ? [root] : routes.slice(0, -1);
      removedRoutes.forEach(route => leaveGuards.delete(route.key));
      return true;
    } catch {
      // A failed confirmation must not discard the active screen.
      return false;
    } finally {
      isTransitioning = false;
      publish();
    }
  }

  async function requestTabSwitch(): Promise<boolean> {
    if (isTransitioning) return false;
    const from = routes[routes.length - 1];
    const root = routes[0];
    if (!from || !root) return false;

    invalidateApproval();
    isTransitioning = true;
    publish();
    try {
      const guard = leaveGuards.get(from.key);
      if (!guard) return false;
      return await guard({ intent: 'tab', from, to: root });
    } catch {
      return false;
    } finally {
      isTransitioning = false;
      publish();
    }
  }

  /** Preserve an explicit cancel separately from an unavailable or stale guard. */
  async function requestTabSwitchDecision(): Promise<
    'approved' | 'declined' | 'unavailable' | 'busy'
  > {
    if (isTransitioning) return 'busy';
    const from = routes[routes.length - 1];
    const root = routes[0];
    if (!from || !root) return 'unavailable';
    invalidateApproval();
    const decisionRevision = approvalRevision;
    isTransitioning = true;
    publish();
    try {
      const guard = leaveGuards.get(from.key);
      if (!guard) return 'unavailable';
      let declined = false;
      const allowed = await guard({ intent: 'tab', from, to: root }, () => {
        declined = true;
      });
      if (!allowed && declined) return 'declined';
      if (decisionRevision !== approvalRevision) return 'unavailable';
      if (allowed) approvedRoot = { key: from.key, revision: decisionRevision };
      return allowed ? 'approved' : declined ? 'declined' : 'unavailable';
    } catch {
      return 'unavailable';
    } finally {
      isTransitioning = false;
      publish();
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeEntryAvailability: listener => {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
    setLeaveStateAvailability: (routeKey, available) => {
      if (leaveStateAvailability.get(routeKey) === available) return;
      invalidateApproval();
      leaveStateAvailability.set(routeKey, available);
      if (!available && availabilityKey === routeKey) availabilityKey = '';
      updateAvailability();
    },
    push: name => addRoute(name, false),
    replace: name => addRoute(name, true),
    registerLeaveGuard: (routeKey, guard) => {
      if (!routes.some(route => route.key === routeKey)) return () => {};
      invalidateApproval();
      leaveGuards.set(routeKey, guard);
      updateAvailability();
      return () => {
        if (leaveGuards.get(routeKey) === guard) {
          invalidateApproval();
          leaveGuards.delete(routeKey);
          updateAvailability();
        }
      };
    },
    // Called only for an already-completed, unguarded native pop; never dispatch a second pop.
    reconcileNativeBack: routeKey => {
      if (
        isTransitioning ||
        routes.length < 2 ||
        snapshot.currentRoute.key !== routeKey
      )
        return false;
      invalidateApproval();
      routes = routes.slice(0, -1);
      leaveGuards.delete(routeKey);
      publish();
      return true;
    },
    commitApprovedRoot: expectedRouteKey => {
      const approval = approvedRoot;
      approvedRoot = null;
      if (
        isTransitioning ||
        !approval ||
        approval.key !== expectedRouteKey ||
        approval.revision !== approvalRevision ||
        snapshot.currentRoute.key !== expectedRouteKey
      )
        return false;
      invalidateApproval();
      routes.slice(1).forEach(route => {
        leaveGuards.delete(route.key);
        leaveStateAvailability.delete(route.key);
      });
      routes = [routes[0]!];
      publish();
      return true;
    },
    requestBack: () => requestLeave('back'),
    requestHome: () => requestLeave('home'),
    requestTabSwitch,
    requestTabSwitchDecision,
  };
}
