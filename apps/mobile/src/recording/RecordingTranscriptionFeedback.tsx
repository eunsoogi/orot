import { ActivityIndicator, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';
import { recordingTranscriptionFeedbackStyles as styles } from './RecordingTranscriptionFeedback.styles';

interface RecordingTranscriptionFeedbackProps {
  readonly snapshot: AutomaticTranscriptionSnapshot | null;
  readonly onRetry: () => void;
}

/** Keeps automatic on-device transcription progress and recovery beside its saved audio. */
export default function RecordingTranscriptionFeedback({
  snapshot,
  onRetry,
}: RecordingTranscriptionFeedbackProps) {
  if (!snapshot || snapshot.status === 'complete') return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={styles.container}
      testID={
        snapshot.status === 'running'
          ? 'recording-transcription-progress'
          : 'recording-transcription-failed'
      }
    >
      {snapshot.status === 'running' ? (
        <>
          <ActivityIndicator color={appColors.primary} />
          <AppText>{t('recording.transcript.autoProgress')}</AppText>
        </>
      ) : (
        <>
          <AppText accessibilityRole="alert" style={styles.error}>
            {t('recording.transcript.autoFailed')}
          </AppText>
          <AppButton
            onPress={onRetry}
            testID="recording-transcription-retry"
            title={t('recording.transcript.retry')}
          />
        </>
      )}
    </View>
  );
}
