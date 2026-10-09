import { useCallback, useRef, useState } from 'react';
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
  const [sourceReference, setSourceReference] =
    useState<EvidenceReference | null>(null);
  const [sourceReturnRoute, setSourceReturnRoute] =
    useState<FeatureScreenRoute>('entry');
  const [sourceReturnRouteKey, setSourceReturnRouteKey] = useState<
    string | null
  >(null);
  const [providerReturnRoute, setProviderReturnRoute] =
    useState<FeatureScreenRoute>('entry');
  const [providerReturnRouteKey, setProviderReturnRouteKey] = useState<
    string | null
  >(null);
  const [selectedAiRevision, setSelectedAiRevision] = useState(0);
  const [visitQuestionsStateRevision, setVisitQuestionsStateRevision] =
    useState(0);
  const [articleOpenError, setArticleOpenError] = useState(false);
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
    setProviderReturnRoute(returnRoute);
    setProviderReturnRouteKey(returnRouteKey);
    if (!providerSelectionOpen) navigation.push('provider-selection');
  }, [
    navigation,
    providerReturnRoute,
    providerReturnRouteKey,
    providerSelectionOpen,
    routeName,
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
      setSourceReference(reference);
      setSourceReturnRoute(returnRoute);
      setSourceReturnRouteKey(returnRouteKey);
      if (!sourceDetailOpen) navigation.push('source-detail');
    },
    [
      navigation,
      providerReturnRoute,
      providerReturnRouteKey,
      providerSelectionOpen,
      routeName,
      sourceDetailOpen,
      sourceReturnRoute,
      sourceReturnRouteKey,
    ],
  );

  const handleOpenArticle = useCallback(
    async (publication: ExternalMedicalPublication) => {
      try {
        await onOpenArticle(publication);
        setArticleOpenError(false);
      } catch {
        setArticleOpenError(true);
      }
    },
    [onOpenArticle],
  );
  const pushFeatureRoute = useCallback(
    (route: FeatureScreenRoute) => navigation.push(route),
    [navigation],
  );
  const reportProviderNavigationState = useCallback(
    (state: ProviderSelectionNavigationState) => {
      providerNavigationStateRef.current = state;
    },
    [],
  );
  const reportVisitQuestionsRouteState = useCallback(
    (state: VisitQuestionsRouteState) => {
      visitQuestionsNavigationStateRef.current = state;
      setVisitQuestionsStateRevision(revision => revision + 1);
    },
    [],
  );
  const reportFeatureNavigationState = useCallback(
    (routeKey: string, state: NavigationLeaveState | null) => {
      if (state) featureNavigationStatesRef.current.set(routeKey, state);
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
