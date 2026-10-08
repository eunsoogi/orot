import { Alert } from 'react-native';
import { navigationText } from '../i18n/navigation';
import type { NavigationLeaveConfirmation } from './navigationLeaveGuard';

type LeaveCopy = {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly cancel: string;
};

function copyForReasons(
  reasons: NavigationLeaveConfirmation<string>['reasons'],
) {
  const hasUnsavedChanges = reasons.includes('unsaved-changes');
  const isRecording = reasons.includes('recording');

  if (hasUnsavedChanges && isRecording) {
    return navigationText.leaveUnsavedAndRecording;
  }
  if (hasUnsavedChanges) return navigationText.leaveUnsaved;
  return navigationText.leaveRecording;
}

export function confirmNavigationLeave<Name extends string>(
  request: NavigationLeaveConfirmation<Name>,
): Promise<boolean> {
  if (request.reasons.length === 0) return Promise.resolve(true);

  const copy: LeaveCopy = copyForReasons(request.reasons);
  return new Promise(resolve => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      resolve(approved);
    };

    // Button taps and native dismissal resolve through one awaited guard result.
    Alert.alert(
      copy.title,
      copy.message,
      [
        { text: copy.cancel, style: 'cancel', onPress: () => finish(false) },
        {
          text: copy.confirm,
          style: 'destructive',
          onPress: () => finish(true),
        },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
}
