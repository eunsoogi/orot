import { useSyncExternalStore } from 'react';
import type {
  NavigationController,
  NavigationSnapshot,
} from './navigationController';

// Keep React screens subscribed to the same route state used by navigation actions.
export function useNavigationSnapshot<Name extends string>(
  controller: NavigationController<Name>,
): NavigationSnapshot<Name> {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}
