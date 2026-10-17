import { useMemo } from 'react';
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
export function AppAiFeatureScene({
  actions,
  ...props
}: Omit<AiFeatureFlowProps, 'navigation' | 'onOpenArticle'> & {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
}) {
  if (!isAppAiRoute(actions.route.name)) return null;
  // The feature router can only push its declared subset of the app's route union.
  const navigation = actions as NavigationRouteActions<AiFeatureRouteName>;
  return (
    <AiFeatureFlow
      {...props}
      navigation={navigation}
      onOpenArticle={openEuropePmcArticle}
    />
  );
}
