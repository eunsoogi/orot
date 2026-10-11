import { View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { formatRecordedAt } from './formatRecordedAt';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import RecordingPlaybackControls from './RecordingPlaybackControls';
import type { RecordingLibrarySummary } from './recordingLibraryService';
import type { RecordingService } from './recordingTypes';

interface RecordingLibraryDetailProps {
  readonly summary: RecordingLibrarySummary;
  readonly disabled: boolean;
  readonly playbackService: Pick<RecordingService, 'playRange'>;
  readonly onClose: () => void;
  readonly onDelete: () => void;
}

/** Groups full-audio playback with the selected source's date and secondary actions. */
export default function RecordingLibraryDetail({
  summary,
  disabled,
  playbackService,
  onClose,
  onDelete,
}: RecordingLibraryDetailProps) {
  const { source } = summary;
  return (
    <View style={styles.detail} testID="recording-detail">
      <Text accessibilityRole="header" style={styles.title}>
        {source.title ?? t('recording.library.untitled')}
      </Text>
      <Text style={styles.detailMetadata} testID="recording-detail-date">
        {formatRecordedAt(source.recordedAt)}
      </Text>
      <RecordingPlaybackControls
        durationMs={summary.durationMs}
        playbackService={playbackService}
        recordingId={source.id}
      />
      <View style={styles.actions}>
        <AppButton
          disabled={disabled}
          onPress={onClose}
          testID="recording-detail-close"
          title={t('recording.library.closeDetails')}
          variant="secondary"
        />
        <AppButton
          disabled={disabled}
          onPress={onDelete}
          testID="recording-detail-delete"
          title={t('recording.library.delete')}
          variant="secondary"
        />
      </View>
    </View>
  );
}
