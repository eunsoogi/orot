import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import { Alert } from 'react-native';

/** A stale/cancelled dialog cannot grant authority to a later request. */
export function confirmHistorySave(
  text: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
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
      t('historyDisplay.saveTitle'),
      text,
      [
        { text: navigationText.cancel.label, style: 'cancel', onPress: cancel },
        { text: navigationText.save, onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  });
}
