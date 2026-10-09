import { useEffect, useMemo, useState } from 'react';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { NavigationLeaveStateSource } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import { useNavigationSnapshot } from '../../navigation/useNavigationSnapshot';
import { openEuropePmcArticle } from './articleLinks';
import { AiFeatureFlow } from './AiFeatureFlow';
import type { AiFeatureFlowProps } from './AiFeatureFlow';
import type {
  AiFeatureRouteName,
  FeatureScreenRoute,
} from './aiFeatureNavigation';

export interface AiFeatureRouteProps extends Omit<
  AiFeatureFlowProps,
  'navigation' | 'onOpenArticle'
> {
  readonly initialRoute?: FeatureScreenRoute | 'provider-selection';
  readonly onBack: () => void;
  readonly onOpenArticle?: AiFeatureFlowProps['onOpenArticle'];
}

/** Keeps one guarded route tree mounted so provider/source overlays preserve feature state. */
export function AiFeatureRoute({
  onBack,
  initialRoute = 'entry',
  onOpenArticle = openEuropePmcArticle,
  renderVisitQuestions,
  serviceDependencies,
  onProviderSelectionCommitted,
}: AiFeatureRouteProps) {
  const [controller] = useState(() => {
    const navigation =
      createNavigationController<AiFeatureRouteName>('app-home');
    // Push the chosen home destination over the internal root so Back returns to App.
    navigation.push(initialRoute);
    return navigation;
  });
  const snapshot = useNavigationSnapshot(controller);
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

  useEffect(() => {
    // The app owns the parent route; reaching its root closes this feature flow.
    if (snapshot.currentRoute.name === 'app-home') onBack();
  }, [onBack, snapshot.currentRoute.name]);

  return (
    <NavigationRouteAdapter controller={controller} leaveState={rootLeaveState}>
      {navigation =>
        navigation.route.name === 'app-home' ? null : (
          <AiFeatureFlow
            navigation={navigation}
            onOpenArticle={onOpenArticle}
            renderVisitQuestions={renderVisitQuestions}
            serviceDependencies={serviceDependencies}
            // The app stores only a display label outside the selected-provider store.
            onProviderSelectionCommitted={onProviderSelectionCommitted}
          />
        )
      }
    </NavigationRouteAdapter>
  );
}
