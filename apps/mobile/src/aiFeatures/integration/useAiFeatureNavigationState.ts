import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { confirmNavigationLeave } from '../../navigation/navigationLeaveConfirmation';
import type { NavigationLeaveState } from '../../navigation/navigationLeaveGuard';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type { AiFeatureRouteName } from './aiFeatureNavigation';

export type AiFeatureNavigationStateChange = (
  routeKey: string,
  state: NavigationLeaveState | null,
) => void;

export type AiFeatureScreenLeaveState = Omit<
  NavigationLeaveState,
  'revision' | 'inputRevision'
>;

/** Publishes committed screen state before the shared back guard can read it. */
export function useAiFeatureScreenNavigationState(
  routeKey: string | undefined,
  state: AiFeatureScreenLeaveState,
  inputRevision: number,
  onChange?: AiFeatureNavigationStateChange,
) {
  const revision = useRef(0);
  const {
    hasOngoingOperation,
    hasUnsavedChanges,
    isRecording,
    ongoingOperationKind,
  } = state;

  useLayoutEffect(() => {
    if (!routeKey || !onChange) return;
    revision.current += 1;
    onChange(routeKey, {
      hasUnsavedChanges,
      isRecording,
      hasOngoingOperation,
      ongoingOperationKind,
      revision: revision.current,
      inputRevision,
    });
  }, [
    hasOngoingOperation,
    hasUnsavedChanges,
    inputRevision,
    isRecording,
    onChange,
    ongoingOperationKind,
    routeKey,
  ]);

  useEffect(() => {
    if (!routeKey || !onChange) return;
    return () => onChange(routeKey, null);
  }, [onChange, routeKey]);
}

/** Requires each stateful feature route to publish its own leave state. */
export function useAiFeatureRouteLeaveState(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
  statesByRouteKey: MutableRefObject<Map<string, NavigationLeaveState>>,
) {
  const route = navigation.route;
  useLayoutEffect(() => {
    if (!isStatefulFeatureRoute(route.name)) return;
    const routeKey = route.key;
    return navigation.registerLeaveState({
      readState: () => {
        const state = statesByRouteKey.current.get(routeKey);
        if (!state)
          throw new Error('The active AI screen has not reported state.');
        return state;
      },
      confirm: confirmNavigationLeave,
    });
  }, [navigation, route.key, route.name, statesByRouteKey]);
}

/** Gives the intentionally read-only entry route an explicit clean owner. */
export function useAiFeatureStatelessRouteLeaveState(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
) {
  const route = navigation.route;
  useLayoutEffect(() => {
    if (route.name !== 'entry') return;
    return navigation.registerLeaveState({
      readState: () => ({
        hasUnsavedChanges: false,
        isRecording: false,
        hasOngoingOperation: false,
        revision: 0,
        inputRevision: 0,
      }),
    });
  }, [navigation, route.key, route.name]);
}

function isStatefulFeatureRoute(
  route: AiFeatureRouteName,
): route is
  | 'disease-hypotheses'
  | 'rag-conversation'
  | 'external-evidence'
  | 'source-detail' {
  return (
    route === 'disease-hypotheses' ||
    route === 'rag-conversation' ||
    route === 'external-evidence' ||
    route === 'source-detail'
  );
}
