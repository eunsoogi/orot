import { useLayoutEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import type { VisitQuestionsRouteState } from './AiFeatureFlowScreen';

/** The app-lifetime session retains generation, review and saves across Back/Home/swipe. */
export function useVisitQuestionsLeaveGuard(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
  stateRef: MutableRefObject<VisitQuestionsRouteState | null>,
  stateRevision: number,
) {
  useLayoutEffect(() => {
    if (navigation.route.name !== 'visit-questions') return;

    return navigation.registerLeaveState({
      readState: () => {
        return {
          // Leaving changes only presentation; it neither abandons candidates nor cancels a write.
          hasUnsavedChanges: false,
          isRecording: false,
          hasOngoingOperation: false,
          revision: stateRef.current?.revision ?? 0,
          inputRevision: 0,
        };
      },
    });
    // Refresh the source so the adapter can reread Back availability.
  }, [navigation, stateRef, stateRevision]);
}
