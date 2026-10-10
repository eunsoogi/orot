export type NavigationIntent = 'back' | 'home' | 'tab';

export interface NavigationRoute<Name extends string> {
  readonly key: string;
  readonly name: Name;
}

export interface NavigationTransition<Name extends string> {
  readonly intent: NavigationIntent;
  readonly from: NavigationRoute<Name>;
  readonly to: NavigationRoute<Name>;
}

export type NavigationLeaveGuard<Name extends string> = (
  transition: NavigationTransition<Name>,
) => boolean | Promise<boolean>;

export interface NavigationSnapshot<Name extends string> {
  readonly routes: readonly NavigationRoute<Name>[];
  readonly currentRoute: NavigationRoute<Name>;
  readonly canGoBack: boolean;
  readonly isTransitioning: boolean;
}

export interface NavigationController<Name extends string> {
  getSnapshot: () => NavigationSnapshot<Name>;
  subscribe: (listener: () => void) => () => void;
  push: (name: Name) => NavigationRoute<Name> | null;
  replace: (name: Name) => NavigationRoute<Name> | null;
  registerLeaveGuard: (
    routeKey: string,
    guard: NavigationLeaveGuard<Name>,
  ) => () => void;
  requestBack: () => Promise<boolean>;
  requestHome: () => Promise<boolean>;
  requestTabSwitch: () => Promise<boolean>;
}

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
  const leaveGuards = new Map<string, NavigationLeaveGuard<Name>>();
  let sequence = 1;
  let routes: readonly NavigationRoute<Name>[] = [
    createRoute(initialRoute, sequence),
  ];
  let isTransitioning = false;
  let snapshot = createSnapshot(routes, isTransitioning);

  function publish() {
    snapshot = createSnapshot(routes, isTransitioning);
    listeners.forEach(listener => listener());
  }

  function addRoute(name: Name, replaceCurrent: boolean) {
    if (isTransitioning) return null;
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

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push: name => addRoute(name, false),
    replace: name => addRoute(name, true),
    registerLeaveGuard: (routeKey, guard) => {
      if (!routes.some(route => route.key === routeKey)) return () => {};
      leaveGuards.set(routeKey, guard);
      return () => {
        if (leaveGuards.get(routeKey) === guard) leaveGuards.delete(routeKey);
      };
    },
    requestBack: () => requestLeave('back'),
    requestHome: () => requestLeave('home'),
    requestTabSwitch,
  };
}
