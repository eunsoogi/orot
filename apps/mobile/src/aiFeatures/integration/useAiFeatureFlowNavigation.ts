import { useCallback, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import type { ProviderSelectionNavigationState } from '../../providers/selection/ProviderSelectionFlow';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type { NavigationLeaveState } from '../../navigation/navigationLeaveGuard';
import type {
  AiFeatureRouteName,
  FeatureScreenRoute,
} from './aiFeatureNavigation';
import { isFeatureScreenRoute } from './aiFeatureNavigation';
import type { VisitQuestionsRouteState } from './AiFeatureFlowScreen';
import {
  useAiFeatureRouteLeaveState,
  useAiFeatureStatelessRouteLeaveState,
} from './useAiFeatureNavigationState';
import { useProviderSelectionLeaveGuard } from './useProviderSelectionLeaveGuard';
import { useVisitQuestionsLeaveGuard } from './useVisitQuestionsLeaveGuard';
import { useAiFeatureSharedNavigationState } from './AiFeatureSharedNavigationState';

const emptyProviderNavigationState: ProviderSelectionNavigationState = {
  hasPendingSelection: false,
  isSavingSelection: false,
  isSigningIn: false,
  revision: 0,
  inputRevision: 0,
};

/** Owns return-route keys so overlays keep guarding the feature subtree beneath them. */
export function useAiFeatureFlowNavigation(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
  onOpenArticle: (
    publication: ExternalMedicalPublication,
  ) => void | Promise<void>,
) {
  const { state, setState } = useAiFeatureSharedNavigationState();
  const {
    articleOpenError,
    providerReturnRoute,
    providerReturnRouteKey,
    selectedAiRevision,
    sourceReference,
    sourceReturnRoute,
    sourceReturnRouteKey,
  } = state;
  const setSelectedAiRevision = useCallback(
    (update: SetStateAction<number>) =>
      setState(current => ({
        ...current,
        selectedAiRevision:
          typeof update === 'function'
            ? update(current.selectedAiRevision)
            : update,
      })),
    [setState],
  );
  const [visitQuestionsStateRevision, setVisitQuestionsStateRevision] =
    useState(0);
  const providerNavigationStateRef = useRef<ProviderSelectionNavigationState>(
    emptyProviderNavigationState,
  );
  const visitQuestionsNavigationStateRef =
    useRef<VisitQuestionsRouteState | null>(null);
  const featureNavigationStatesRef = useRef(
    new Map<string, NavigationLeaveState>(),
  );
  const routeName = navigation.route.name;
  const providerSelectionOpen = routeName === 'provider-selection';
  const sourceDetailOpen = routeName === 'source-detail';
  const screenRoute = providerSelectionOpen
    ? providerReturnRoute
    : sourceDetailOpen
      ? sourceReturnRoute
      : isFeatureScreenRoute(routeName)
        ? routeName
        : 'entry';
  // Keep the original route key while an overlay is visible so its state guard stays active.
  const screenRouteKey = providerSelectionOpen
    ? providerReturnRouteKey
    : sourceDetailOpen
      ? sourceReturnRouteKey
      : isFeatureScreenRoute(routeName)
        ? navigation.route.key
        : null;

  const openProviderSelection = useCallback(() => {
    const returnRoute =
      routeName === 'source-detail'
        ? sourceReturnRoute
        : routeName === 'provider-selection'
          ? providerReturnRoute
          : isFeatureScreenRoute(routeName)
            ? routeName
            : 'entry';
    const returnRouteKey = sourceDetailOpen
      ? sourceReturnRouteKey
      : providerSelectionOpen
        ? providerReturnRouteKey
        : navigation.route.key;
    providerNavigationStateRef.current = { ...emptyProviderNavigationState };
    setState(current => ({
      ...current,
      providerReturnRoute: returnRoute,
      providerReturnRouteKey: returnRouteKey,
    }));
    if (!providerSelectionOpen) navigation.push('provider-selection');
  }, [
    navigation,
    providerReturnRoute,
    providerReturnRouteKey,
    providerSelectionOpen,
    routeName,
    setState,
    sourceDetailOpen,
    sourceReturnRoute,
    sourceReturnRouteKey,
  ]);

  const openSource = useCallback(
    (reference: EvidenceReference) => {
      const returnRoute =
        routeName === 'provider-selection'
          ? providerReturnRoute
          : routeName === 'source-detail'
            ? sourceReturnRoute
            : isFeatureScreenRoute(routeName)
              ? routeName
              : 'entry';
      const returnRouteKey = providerSelectionOpen
        ? providerReturnRouteKey
        : sourceDetailOpen
          ? sourceReturnRouteKey
          : navigation.route.key;
      setState(current => ({
        ...current,
        sourceReference: reference,
        sourceReturnRoute: returnRoute,
        sourceReturnRouteKey: returnRouteKey,
      }));
      if (!sourceDetailOpen) navigation.push('source-detail');
    },
    [
      navigation,
      providerReturnRoute,
      providerReturnRouteKey,
      providerSelectionOpen,
      routeName,
      setState,
      sourceDetailOpen,
      sourceReturnRoute,
      sourceReturnRouteKey,
    ],
  );

  const handleOpenArticle = useCallback(
    async (publication: ExternalMedicalPublication) => {
      try {
        await onOpenArticle(publication);
        setState(current => ({ ...current, articleOpenError: false }));
      } catch {
        setState(current => ({ ...current, articleOpenError: true }));
      }
    },
    [onOpenArticle, setState],
  );
  const pushFeatureRoute = useCallback(
    (route: FeatureScreenRoute) => navigation.push(route),
    [navigation],
  );
  const reportProviderNavigationState = useCallback(
    (navigationState: ProviderSelectionNavigationState) => {
      providerNavigationStateRef.current = navigationState;
    },
    [],
  );
  const reportVisitQuestionsRouteState = useCallback(
    (navigationState: VisitQuestionsRouteState) => {
      visitQuestionsNavigationStateRef.current = navigationState;
      setVisitQuestionsStateRevision(revision => revision + 1);
    },
    [],
  );
  const reportFeatureNavigationState = useCallback(
    (routeKey: string, navigationState: NavigationLeaveState | null) => {
      if (navigationState)
        featureNavigationStatesRef.current.set(routeKey, navigationState);
      else featureNavigationStatesRef.current.delete(routeKey);
    },
    [],
  );

  useProviderSelectionLeaveGuard(navigation, providerNavigationStateRef);
  useVisitQuestionsLeaveGuard(
    navigation,
    visitQuestionsNavigationStateRef,
    visitQuestionsStateRevision,
  );
  useAiFeatureRouteLeaveState(navigation, featureNavigationStatesRef);
  useAiFeatureStatelessRouteLeaveState(navigation);

  return {
    articleOpenError,
    handleOpenArticle,
    openProviderSelection,
    openSource,
    providerSelectionOpen,
    pushFeatureRoute,
    reportFeatureNavigationState,
    reportProviderNavigationState,
    reportVisitQuestionsRouteState,
    screenRoute,
    screenRouteKey,
    selectedAiRevision,
    setSelectedAiRevision,
    sourceDetailOpen,
    sourceReference,
  };
}
