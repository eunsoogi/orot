import { useEffect, useState } from 'react';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { NavigationLeaveStateSource } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import { useNavigationSnapshot } from '../../navigation/useNavigationSnapshot';
import { openEuropePmcArticle } from './articleLinks';
import { AiFeatureFlow } from './AiFeatureFlow';
import type { AiFeatureFlowProps } from './AiFeatureFlow';
import type { AiFeatureRouteName } from './aiFeatureNavigation';

export interface AiFeatureRouteProps extends Omit<
  AiFeatureFlowProps,
  'navigation' | 'onOpenArticle'
> {
  readonly onBack: () => void;
  readonly onOpenArticle?: AiFeatureFlowProps['onOpenArticle'];
}

const cleanLeaveState: NavigationLeaveStateSource<AiFeatureRouteName> = {
  readState: () => ({
    hasUnsavedChanges: false,
    isRecording: false,
    revision: 0,
    inputRevision: 0,
  }),
};

/** Keeps one guarded route tree mounted so provider/source overlays preserve feature state. */
export function AiFeatureRoute({
  onBack,
  onOpenArticle = openEuropePmcArticle,
  renderVisitQuestions,
  serviceDependencies,
}: AiFeatureRouteProps) {
  const [controller] = useState(() => {
    const navigation =
      createNavigationController<AiFeatureRouteName>('app-home');
    navigation.push('entry');
    return navigation;
  });
  const snapshot = useNavigationSnapshot(controller);

  useEffect(() => {
    // The app owns the parent route; reaching its root closes this feature flow.
    if (snapshot.currentRoute.name === 'app-home') onBack();
  }, [onBack, snapshot.currentRoute.name]);

  return (
    <NavigationRouteAdapter
      controller={controller}
      leaveState={cleanLeaveState}
    >
      {navigation =>
        navigation.route.name === 'app-home' ? null : (
          <AiFeatureFlow
            navigation={navigation}
            onOpenArticle={onOpenArticle}
            renderVisitQuestions={renderVisitQuestions}
            serviceDependencies={serviceDependencies}
          />
        )
      }
    </NavigationRouteAdapter>
  );
}
