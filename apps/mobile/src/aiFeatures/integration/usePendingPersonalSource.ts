import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import type { NavigationRouteActions } from '../../navigation/navigationRouteContracts';
import type { PersonalSourceLease } from '../../ragConversation/personalToolSourceRoute';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import { isFeatureScreenRoute } from './aiFeatureNavigation';
import { useAiFeatureSharedNavigationState } from './AiFeatureSharedNavigationState';

export type PendingPersonalSource = {
  readonly routeKey: string;
  readonly instance: number;
  readonly lease: PersonalSourceLease;
  readonly dismiss: () => void;
};

/** Own the in-place sheet only while the exact visible source route remains current. */
export function useOpenPendingPersonalSource(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
  originCurrent?: () => boolean,
) {
  const active = useRef<PersonalSourceLease | undefined>(undefined);
  const nextInstance = useRef(0);
  const { setState, ownPendingPersonalSource } =
    useAiFeatureSharedNavigationState();
  return useCallback(
    (lease: PersonalSourceLease) => {
      const { name, key: routeKey } = navigation.route;
      const owner = navigation.ownership;
      if (
        active.current ||
        !isFeatureScreenRoute(name) ||
        !owner?.isCurrent() ||
        originCurrent?.() === false ||
        AppState.currentState !== 'active' ||
        !lease.current()
      )
        return false;
      const subscription = AppState.addEventListener(
        'change',
        function revokeOnInactive(state) {
          if (state !== 'active') lease.retire();
        },
      );
      let observingApp = true;
      const removeAppObserver = () => {
        if (observingApp) subscription.remove();
        observingApp = false;
      };
      const instance = ++nextInstance.current;
      active.current = lease;
      let stopOwner = () => {};
      const dispose = () => {
        if (active.current === lease) active.current = undefined;
        stopOwner();
        lease.signal.removeEventListener('abort', removeAppObserver);
        removeAppObserver();
        lease.retire();
      };
      const dismiss = () => {
        release?.();
        dispose();
        setState(current =>
          current.pendingPersonalSource?.lease === lease
            ? { ...current, pendingPersonalSource: undefined }
            : current,
        );
      };
      const release = ownPendingPersonalSource(dispose);
      if (!release) return false;
      stopOwner = owner.subscribe(() => {
        if (!owner.isCurrent() || originCurrent?.() === false) dismiss();
      });
      lease.signal.addEventListener('abort', removeAppObserver, { once: true });
      if (
        !owner.isCurrent() ||
        originCurrent?.() === false ||
        lease.signal.aborted ||
        AppState.currentState !== 'active'
      ) {
        dismiss();
        return false;
      }
      setState(current => ({
        ...current,
        pendingPersonalSource: { routeKey, instance, lease, dismiss },
      }));
      return true;
    },
    [navigation, originCurrent, ownPendingPersonalSource, setState],
  );
}
