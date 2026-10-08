import { Button, Modal, Text, View } from 'react-native';
import { t } from '../i18n';
import type { RecordingSourceRecord } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';

interface RecordingDeletionConfirmationProps {
  readonly target: RecordingSourceRecord | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
}

/** Keeps destructive confirmation reachable above long, scrollable transcript content. */
export default function RecordingDeletionConfirmation({
  target,
  busy,
  onCancel,
  onConfirm,
}: RecordingDeletionConfirmationProps) {
  return (
    // Keep the native modal mounted after dismissal so iOS receives visible=false.
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={target !== null}
    >
      {target ? (
        <View style={styles.confirmationBackdrop}>
          <View
            accessibilityViewIsModal
            style={styles.confirmation}
            testID="recording-delete-confirmation"
          >
            <Text accessibilityRole="header" style={styles.confirmationTitle}>
              {t('recording.library.confirmTitle')}
            </Text>
            <Text style={styles.copy}>
              {t('recording.library.confirmMessage', {
                title: target.title ?? t('recording.library.untitled'),
              })}
            </Text>
            <View style={styles.actions}>
              <Button
                disabled={busy}
                onPress={onCancel}
                testID="recording-delete-cancel"
                title={t('recording.library.cancel')}
              />
              <Button
                disabled={busy}
                onPress={onConfirm}
                testID="recording-delete-confirm"
                title={
                  busy
                    ? t('recording.library.deleting')
                    : t('recording.library.confirmDelete')
                }
              />
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
