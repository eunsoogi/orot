import { Alert } from 'react-native';
import { navigationText } from '../i18n/navigation';

/** Keep the draft until the user explicitly confirms discarding it. */
export function confirmSymptomDiscard(onDiscard: () => void) {
  const copy = navigationText.leaveUnsaved;
  Alert.alert(copy.title, copy.message, [
    { text: copy.cancel, style: 'cancel' },
    { text: copy.confirm, style: 'destructive', onPress: onDiscard },
  ]);
}
