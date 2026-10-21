import { View } from 'react-native';
import { AppProgress } from '../layout/AppProgress';
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
  const reason = snapshot.failureReason ?? '';
  // Keep automatic recovery aligned with review; only closed reasons select help, never provider details.
  const help = reason.startsWith('PERMISSION_')
    ? t('recording.transcript.permissionHelp')
    : reason === 'MODEL_UNAVAILABLE'
      ? t('recording.transcript.modelHelp')
      : reason === 'UNSUPPORTED_DEVICE' || reason === 'UNSUPPORTED_LANGUAGE'
        ? t('recording.transcript.unsupportedHelp')
        : reason === 'TRANSCRIPTION_TIMEOUT'
          ? t('recording.transcript.timeoutHelp')
          : reason === 'NO_RECOGNIZED_SPEECH'
            ? t('recording.transcript.noSpeechHelp')
            : null;

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
          <AppProgress color={appColors.primary} />
          <AppText>{t('recording.transcript.autoProgress')}</AppText>
        </>
      ) : (
        <>
          <AppText accessibilityRole="alert" style={styles.error}>
            {t('recording.transcript.autoFailed')}
          </AppText>
          {help ? <AppText>{help}</AppText> : null}
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
