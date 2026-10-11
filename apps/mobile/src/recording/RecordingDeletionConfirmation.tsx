import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import type { RecordingSourceRecord } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';

interface RecordingDeletionConfirmationProps {
  readonly target: RecordingSourceRecord | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
}

/** Uses the iOS alert for consent, then exposes non-blocking async deletion progress. */
export default function RecordingDeletionConfirmation({
  target,
  busy,
  onCancel,
  onConfirm,
}: RecordingDeletionConfirmationProps) {
  const callbacks = useRef({ onCancel, onConfirm });
  callbacks.current = { onCancel, onConfirm };

  useEffect(() => {
    if (!target || busy) return;

    Alert.alert(
      t('recording.library.confirmTitle'),
      t('recording.library.confirmMessage', {
        title: target.title ?? t('recording.library.untitled'),
      }),
      [
        {
          text: t('recording.library.cancel'),
          onPress: () => callbacks.current.onCancel(),
          style: 'cancel',
        },
        {
          text: t('recording.library.confirmDelete'),
          onPress: () => {
            void callbacks.current.onConfirm();
          },
          style: 'destructive',
        },
      ],
      { cancelable: false },
    );
  }, [busy, target]);

  if (!busy) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={styles.deleteProgress}
      testID="recording-delete-progress"
    >
      <ActivityIndicator color={appColors.primaryText} size="small" />
      <Text style={styles.copy}>{t('recording.library.deleting')}</Text>
    </View>
  );
}
