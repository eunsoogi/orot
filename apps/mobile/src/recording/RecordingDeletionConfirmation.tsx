import { useEffect, useRef } from 'react';
import { Alert, Text, View } from 'react-native';
import { AppProgress } from '../layout/AppProgress';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import type { RecordingSourceRecord } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';

interface RecordingDeletionConfirmationProps {
  readonly target: RecordingSourceRecord | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
  readonly onProgressPresented?: () => void;
}

/** Uses the iOS alert for consent, then exposes non-blocking async deletion progress. */
export default function RecordingDeletionConfirmation({
  target,
  busy,
  onCancel,
  onConfirm,
  onProgressPresented,
}: RecordingDeletionConfirmationProps) {
  const callbacks = useRef({ onCancel, onConfirm });
  const progressReported = useRef(false);
  callbacks.current = { onCancel, onConfirm };

  useEffect(() => {
    if (!busy) progressReported.current = false;
  }, [busy]);

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
            callbacks.current.onConfirm();
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
      onLayout={
        onProgressPresented
          ? () => {
              if (progressReported.current) return;
              progressReported.current = true;
              // The first native layout is the closest UI boundary for when progress is presented.
              onProgressPresented();
            }
          : undefined
      }
      style={styles.deleteProgress}
      testID="recording-delete-progress"
    >
      <AppProgress color={appColors.primaryText} size="small" />
      <Text style={styles.copy}>{t('recording.library.deleting')}</Text>
    </View>
  );
}
