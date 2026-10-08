import { useEffect } from 'react';
import { Alert } from 'react-native';
import type { MutableRefObject } from 'react';
import { confirmNavigationLeave } from '../../navigation/navigationLeaveConfirmation';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type { ProviderSelectionNavigationState } from '../../providers/selection/ProviderSelectionFlow';
import { providerSelectionText } from '../../providers/selection/text';
import type { AiFeatureRouteName } from './aiFeatureNavigation';

/** Binds provider draft/save state to the same guard used by button and edge back. */
export function useProviderSelectionLeaveGuard(
  navigation: NavigationRouteActions<AiFeatureRouteName>,
  stateRef: MutableRefObject<ProviderSelectionNavigationState>,
) {
  useEffect(() => {
    if (navigation.route.name !== 'provider-selection') return;

    return navigation.registerLeaveState({
      readState: () => ({
        hasUnsavedChanges: stateRef.current.hasPendingSelection,
        isRecording: false,
        revision: stateRef.current.revision,
        inputRevision: stateRef.current.inputRevision,
      }),
      confirm: async request => {
        // Selection persistence cannot be canceled; keep its owning route mounted.
        if (stateRef.current.isSavingSelection) {
          Alert.alert(
            providerSelectionText.saveInProgressTitle,
            providerSelectionText.saveInProgressMessage,
            [
              {
                text: providerSelectionText.saveInProgressConfirm,
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
