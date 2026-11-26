import type {
  NavigationRoute,
  NavigationSnapshot,
  OwnedNavigationRoute,
} from './navigationControllerTypes';

/** Adopt a pushed route before subscribers can replace it; covering it retires it permanently. */
export function createOwnedNavigationPush<Name extends string>() {
  type Entry = { key: string; controller: AbortController; previous?: Entry };
  let active: Entry | undefined;
  return {
    observe(snapshot: NavigationSnapshot<Name>) {
      const current = active;
      if (!current) return;
      const previous = current.previous;
      current.previous = undefined;
      const lost = snapshot.currentRoute.key !== current.key;
      if (lost) active = undefined;
      previous?.controller.abort();
      if (lost) current.controller.abort();
    },
    push(
      add: (adopt: (route: NavigationRoute<Name>) => void) => void,
    ): OwnedNavigationRoute<Name> | null {
      let owned: OwnedNavigationRoute<Name> | null = null;
      add(route => {
        const controller = new AbortController();
        // Defer revocation to the authoritative publish, after the route exists.
        const previous = active;
        active = { key: route.key, controller, previous };
        owned = { route, signal: controller.signal };
      });
      return owned;
    },
  };
}
