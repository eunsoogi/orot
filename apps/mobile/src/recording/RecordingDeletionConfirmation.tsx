import { Modal, Pressable, Text, View } from 'react-native';
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
            <View style={styles.confirmationActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onCancel}
                style={[
                  styles.confirmationAction,
                  styles.confirmationCancel,
                  busy ? styles.confirmationActionDisabled : undefined,
                ]}
                testID="recording-delete-cancel"
              >
                <Text style={styles.confirmationCancelText}>
                  {t('recording.library.cancel')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onConfirm}
                style={[
                  styles.confirmationAction,
                  styles.confirmationConfirm,
                  busy ? styles.confirmationActionDisabled : undefined,
                ]}
                testID="recording-delete-confirm"
              >
                <Text style={styles.confirmationConfirmText}>
                  {busy
                    ? t('recording.library.deleting')
                    : t('recording.library.confirmDelete')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
