import { useCallback, useMemo, useRef, useState } from 'react';
import { useInferenceConsent } from '../../agent/execution/useInferenceConsent';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { NavigationLeaveStateSource } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import { openEuropePmcArticle } from './articleLinks';
import { AiFeatureSharedNavigationStateProvider } from './AiFeatureSharedNavigationState';
import { createAiFeatureServices } from './featureServices';
import type { AiFeatureServices } from './featureServices';
import { AiFeatureFlow } from './AiFeatureFlow';
import type { AiFeatureFlowProps } from './AiFeatureFlow';
import type {
  AiFeatureRouteName,
  FeatureScreenRoute,
} from './aiFeatureNavigation';

export interface AiFeatureRouteProps extends Omit<
  AiFeatureFlowProps,
  'navigation' | 'onOpenArticle' | 'services' | 'consent'
> {
  readonly initialRoute?: FeatureScreenRoute | 'provider-selection';
  readonly onBack: () => void;
  readonly onHome?: () => void;
  readonly onOpenRecording?: () => void;
  readonly onOpenArticle?: AiFeatureFlowProps['onOpenArticle'];
}

/** Keeps one guarded route tree mounted so provider/source overlays preserve feature state. */
export function AiFeatureRoute({
  onBack,
  onHome,
  initialRoute = 'entry',
  onOpenArticle = openEuropePmcArticle,
  renderVisitQuestions,
  serviceDependencies,
  onProviderSelectionCommitted,
}: AiFeatureRouteProps) {
  const { consent, disclosureSheet } = useInferenceConsent();
  // Evidence references are valid only within their registry, so every retained scene shares one service set.
  const services = useMemo<AiFeatureServices>(
    () => createAiFeatureServices(consent, serviceDependencies),
    [consent, serviceDependencies],
  );
  const [controller] = useState(() => {
    const navigation =
      createNavigationController<AiFeatureRouteName>('app-home');
    // Push the chosen home destination over the internal root so Back returns to App.
    navigation.push(initialRoute);
    return navigation;
  });
  const pendingExitIntent = useRef<'home' | null>(null);
  const nativeExitHandled = useRef(false);
  const completeNativeExit = useCallback(
    (routeKey: string) => {
      const current = controller.getSnapshot();
      if (
        current.routes.some(route => route.key === routeKey) ||
        current.currentRoute.name !== 'app-home'
      ) {
        return;
      }
      if (nativeExitHandled.current) return;
      nativeExitHandled.current = true;
      const intent = pendingExitIntent.current;
      pendingExitIntent.current = null;
      if (intent === 'home' && onHome) onHome();
      else onBack();
    },
    [controller, onBack, onHome],
  );
  const rootLeaveState = useMemo<
    NavigationLeaveStateSource<AiFeatureRouteName>
  >(
    () => ({
      readState: () => {
        if (controller.getSnapshot().currentRoute.name !== 'app-home') {
          throw new Error(
            'Only the app home route has a clean fallback state.',
          );
        }
        return {
          hasUnsavedChanges: false,
          isRecording: false,
          hasOngoingOperation: false,
          revision: 0,
          inputRevision: 0,
        };
      },
    }),
    [controller],
  );

  return (
    // Native route scenes keep their own feature state; overlay routing lives above them.
    <AiFeatureSharedNavigationStateProvider>
      <>
        <NavigationRouteAdapter
          controller={controller}
          leaveState={rootLeaveState}
          onNativeRouteRemovalComplete={completeNativeExit}
          showHome
          homeAction={
            onHome
              ? async () => {
                  // Home remains a guarded exit while returning to the source is reserved for Back.
                  pendingExitIntent.current = 'home';
                  if (!(await controller.requestHome())) {
                    pendingExitIntent.current = null;
                  }
                }
              : undefined
          }
        >
          {navigation =>
            navigation.route.name === 'app-home' ? null : (
              <AiFeatureFlow
                consent={consent}
                navigation={navigation}
                onOpenArticle={onOpenArticle}
                renderVisitQuestions={renderVisitQuestions}
                serviceDependencies={serviceDependencies}
                services={services}
                // The app stores only a display label outside the selected-provider store.
                onProviderSelectionCommitted={onProviderSelectionCommitted}
              />
            )
          }
        </NavigationRouteAdapter>
        {disclosureSheet}
      </>
    </AiFeatureSharedNavigationStateProvider>
  );
}
