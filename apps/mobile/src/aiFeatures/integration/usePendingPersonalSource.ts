import { useCallback } from 'react';
import { AppState } from 'react-native';
import type { NavigationRouteActions } from '../../navigation/navigationRouteContracts';
import type { PersonalSourceLease } from '../../ragConversation/personalToolSourceRoute';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import { isFeatureScreenRoute } from './aiFeatureNavigation';
import { useAiFeatureSharedNavigationState } from './AiFeatureSharedNavigationState';

export type PendingPersonalSource = {
  readonly routeKey: string;
  readonly lease: PersonalSourceLease;
};

/** Only the exact successful push owns this in-memory capability across scene mounts. */
export function useOpenPendingPersonalSource(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
  originCurrent?: () => boolean,
) {
  const { setState, ownPendingPersonalSource } =
    useAiFeatureSharedNavigationState();
  return useCallback(
    (lease: PersonalSourceLease) => {
      const { name: returnRoute, key: returnKey } = navigation.route;
      if (
        !isFeatureScreenRoute(returnRoute) ||
        originCurrent?.() === false ||
        AppState.currentState !== 'active' ||
        !lease.current()
      )
        return false;
      const target = navigation.pushOwned?.('source-detail');
      if (!target || target.signal.aborted) return false;
      const routeKey = target.route.key;
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
      const dispose = () => {
        target.signal.removeEventListener('abort', onRouteExit);
        lease.signal.removeEventListener('abort', removeAppObserver);
        removeAppObserver();
        lease.retire();
      };
      const onRouteExit = () => {
        release?.();
        dispose();
        setState(current =>
          current.pendingPersonalSource?.routeKey === routeKey
            ? { ...current, pendingPersonalSource: undefined }
            : current,
        );
      };
      const release = ownPendingPersonalSource(dispose);
      if (!release) return false;
      lease.signal.addEventListener('abort', removeAppObserver, { once: true });
      target.signal.addEventListener('abort', onRouteExit, { once: true });
      if (lease.signal.aborted || AppState.currentState !== 'active') {
        removeAppObserver();
        lease.retire();
      }
      setState(current => ({
        ...current,
        pendingPersonalSource: { routeKey, lease },
        sourceReference: null,
        sourceOwner: undefined,
        sourceReturnRoute: returnRoute,
        sourceReturnRouteKey: returnKey,
      }));
      return true;
    },
    [navigation, originCurrent, ownPendingPersonalSource, setState],
  );
}
