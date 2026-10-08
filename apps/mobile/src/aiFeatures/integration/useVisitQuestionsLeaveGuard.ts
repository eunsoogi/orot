import { useLayoutEffect } from 'react';
import { Alert } from 'react-native';
import type { MutableRefObject } from 'react';
import { confirmNavigationLeave } from '../../navigation/navigationLeaveConfirmation';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import type { VisitQuestionsRouteState } from './AiFeatureFlowScreen';
import { getAiFeatureIntegrationCopy } from './copy';

/** Keeps dirty visit-question drafts on their route and protects active saves. */
export function useVisitQuestionsLeaveGuard(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
  stateRef: MutableRefObject<VisitQuestionsRouteState | null>,
) {
  useLayoutEffect(() => {
    if (navigation.route.name !== 'visit-questions') return;

    return navigation.registerLeaveState({
      readState: () => {
        const state = stateRef.current;
        if (!state)
          throw new Error('The visit-question screen has not reported state.');
        return {
          // A pending write is not safe to abandon until the screen publishes success.
          hasUnsavedChanges: state.hasUnsavedChanges || state.isSaving,
          isRecording: false,
          hasOngoingOperation: false,
          revision: state.revision,
          inputRevision: 0,
        };
      },
      confirm: async request => {
        if (stateRef.current?.isSaving) {
          const copy = getAiFeatureIntegrationCopy();
          Alert.alert(
            copy.visitQuestionsSaveInProgressTitle,
            copy.visitQuestionsSaveInProgressMessage,
            [
              {
                text: copy.visitQuestionsSaveInProgressConfirm,
                onPress: () => undefined,
              },
            ],
          );
          return false;
        }

        return confirmNavigationLeave(request);
      },
    });
  }, [navigation, stateRef]);
}
