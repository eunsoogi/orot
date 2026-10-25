import { Text } from 'react-native';
import { t } from '../i18n';
import { recordingLibraryStyles } from './RecordingLibraryPanel.styles';

type RecordingDeletionNoticeProps = {
  readonly notice: 'error' | 'cleanup-pending' | null;
};

/** Distinguishes an uncommitted source failure from media cleanup queued after a committed source cascade. */
export default function RecordingDeletionNotice({
  notice,
}: RecordingDeletionNoticeProps) {
  if (!notice) return null;
  const error = notice === 'error';
  return (
    <Text
      accessibilityRole="alert"
      style={recordingLibraryStyles.error}
      testID={
        error ? 'recording-delete-error' : 'recording-delete-cleanup-pending'
      }
    >
      {t(
        error
          ? 'recording.library.deleteError'
          : 'recording.library.cleanupPending',
      )}
    </Text>
  );
}
