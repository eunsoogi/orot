import { View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
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
      <Text style={styles.copy}>{t('recording.subtitle')}</Text>
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
      <Text style={styles.copy} testID="recording-consent-description">
        {t('recording.consent.description')}
      </Text>
      <Text style={styles.copy} testID="recording-guidance">
        {t(guidanceKey(status))}
      </Text>
      <View style={styles.localNotice}>
        <AppSymbol name="lock.fill" size={20} color={appColors.secondary} />
        <Text style={styles.localNoticeText}>{t('recording.localOnly')}</Text>
      </View>
    </View>
  );
}
