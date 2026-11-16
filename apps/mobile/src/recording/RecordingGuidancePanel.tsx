import { Alert, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { RecordingConsentControl } from './RecordingConsentControl';
import { recordingControlStyles as styles } from './RecordingControls.styles';
import type { RecordingStatus } from './recordingTypes';

function guidanceKey(status: RecordingStatus) {
  if (status === 'recording') return 'recording.microphone.stopHint';
  if (status === 'paused' || status === 'interrupted') {
    return 'recording.microphone.pausedHint';
  }
  return status === 'completed' ? 'recording.afterSave' : 'recording.readyHint';
}

/** Keeps consent and its local-storage guidance beside the recording session without mixing live status. */
export default function RecordingGuidancePanel({
  status,
  consentAcknowledged,
  controlsBusy,
  onToggleConsent,
}: {
  readonly status: RecordingStatus;
  readonly consentAcknowledged: boolean;
  readonly controlsBusy: boolean;
  readonly onToggleConsent: () => void;
}) {
  return (
    <View style={styles.guidancePanel} testID="recording-guidance-panel">
      <RecordingConsentControl
        checked={consentAcknowledged}
        onPress={onToggleConsent}
        disabled={
          controlsBusy ||
          status === 'recording' ||
          status === 'paused' ||
          status === 'interrupted'
        }
      />
      <AppButton
        variant="text"
        title={t('recording.guidanceDetails')}
        testID="recording-guidance-details"
        onPress={() =>
          Alert.alert(
            t('recording.title'),
            [
              t('recording.subtitle'),
              t('recording.consent.description'),
              t(guidanceKey(status)),
              t('recording.localOnly'),
            ].join('\n\n'),
          )
        }
      />
    </View>
  );
}
