import { useCallback, useMemo } from 'react';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { AiFeatureFlow } from '../aiFeatures/integration/AiFeatureFlow';
import type { AiFeatureFlowProps } from '../aiFeatures/integration/AiFeatureFlow';
import { openEuropePmcArticle } from '../aiFeatures/integration/articleLinks';
import { createAiFeatureServices } from '../aiFeatures/integration/featureServices';
import type { AiFeatureServiceDependencies } from '../aiFeatures/integration/featureServices';
import type { AiFeatureRouteName } from '../aiFeatures/integration/aiFeatureNavigation';
import { isFeatureScreenRoute } from '../aiFeatures/integration/aiFeatureNavigation';
import type { AppNavigationRoute } from './appNavigationRoute';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';

/** Keeps citations and inference consent shared across retained scenes in App's single stack. */
export function useAppAiServices(dependencies?: AiFeatureServiceDependencies) {
  const { consent, disclosureSheet } = useInferenceConsent();
  const services = useMemo(
    () => createAiFeatureServices(consent, dependencies),
    [consent, dependencies],
  );
  return { consent, services, disclosureSheet };
}

export function isAppAiRoute(
  name: AppNavigationRoute,
): name is AiFeatureRouteName {
  return (
    isFeatureScreenRoute(name as AiFeatureRouteName) ||
    name === 'provider-selection' ||
    name === 'source-detail'
  );
}

/** Only AI destinations enter the feature router; Back/Home retain the app controller. */
export function AppConversationScene({
  actions,
  defaultConversation = false,
  isEntryCurrent,
  isRouteCurrent,
  ...props
}: Omit<
  AiFeatureFlowProps,
  'navigation' | 'onOpenArticle' | 'onOpenConversationModelSettings'
> & {
  readonly defaultConversation?: boolean;
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
}) {
  // Stable identity prevents the root scene from continuously replacing its leave-state owner.
  const navigation = useMemo(
    () =>
      (defaultConversation
        ? { ...actions, route: { ...actions.route, name: 'rag-conversation' } }
        : actions) as NavigationRouteActions<AiFeatureRouteName>,
    [actions, defaultConversation],
  );
  const openConversationModelSettings = useCallback(() => {
    // Both entry points push the same destination. The native stack keeps the
    // originating tab and draft, and the shared route owns confirmation.
    if ((isEntryCurrent ?? isRouteCurrent)?.() === false) return;
    actions.push('settings-provider');
  }, [actions, isEntryCurrent, isRouteCurrent]);
  if (!defaultConversation && !isAppAiRoute(actions.route.name)) return null;
  return (
    <AiFeatureFlow
      {...props}
      navigation={navigation}
      canonicalConversationRoot={defaultConversation}
      isEntryCurrent={isEntryCurrent}
      isRouteCurrent={isRouteCurrent}
      onOpenArticle={openEuropePmcArticle}
      onOpenConversationModelSettings={openConversationModelSettings}
    />
  );
}
