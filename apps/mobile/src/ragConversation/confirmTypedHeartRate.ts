import { Alert } from 'react-native';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import type { TypedHeartRateRecipient } from '../aiFeatures/integration/conversationHeartRateModelOwner';
import type { ConversationHeartRateRequest } from '../aiFeatures/integration/conversationHeartRateRequest';

/** Clarify the exact requested records under the already selected text Conversation model. */
export function confirmTypedHeartRate(
  scope: ConversationHeartRateRequest,
  recipient: TypedHeartRateRecipient,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted || scope.category === 'workout_heart_rate') return Promise.resolve(false);
  const label = {
    ordinary_average: 'healthContextCopy.ordinaryHeartRate',
    resting_heart_rate: 'healthContextCopy.restingHeartRate',
    walking_heart_rate_average: 'healthContextCopy.walkingHeartRate',
  } as const;
  const body =
    t(label[scope.category]) +
    '\n' +
    scope.fromInclusive +
    ' ~ ' +
    scope.toExclusive +
    '\n' +
    t('healthContextCopy.confirmTypedHeartRateExclusive') +
    '\n\n' +
    recipient.modelName +
    ' - ' +
    recipient.recipient +
    '\n' +
    t(
      recipient.remoteProcessing
        ? 'healthContextCopy.confirmTypedHeartRateRemote'
        : 'healthContextCopy.confirmTypedHeartRateLocal',
    );
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      resolve(approved && !signal.aborted);
    };
    const cancel = () => finish(false);
    signal.addEventListener('abort', cancel, { once: true });
    Alert.alert(
      t('healthContextCopy.confirmTypedHeartRateTitle'),
      body,
      [
        { text: navigationText.cancel.label, style: 'cancel', onPress: cancel },
        { text: t('healthContextCopy.confirmTypedHeartRateAction'), onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  });
}
