import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { RecordingConsentControl } from './RecordingConsentControl';
import { t } from '../i18n';
import { recordingStatusLabel } from './recordingStatusLabel';
import {
  formatRecordingDuration,
  type RecordingStatus,
} from './recordingTypes';
import { recordingControlStyles } from './RecordingControls.styles';

interface RecordingSessionPanelProps {
  status: RecordingStatus;
  durationMs: number;
  consentAcknowledged: boolean;
  onToggleConsent: () => void;
  controlsBusy: boolean;
  sourceRetryPending: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => Promise<void>;
}

// Consent and session actions stay together; saved-recording actions remain in RecordingControls.
export default function RecordingSessionPanel({
  status,
  durationMs,
  consentAcknowledged,
  onToggleConsent,
  controlsBusy,
  sourceRetryPending,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordingSessionPanelProps) {
  return (
    <>
      <Text
        accessibilityRole="header"
        style={recordingControlStyles.title}
        testID="recording-title"
      >
        {t('recording.title')}
      </Text>
      <Text style={recordingControlStyles.copy}>
        {t('recording.consent.description')}
      </Text>
      <Text style={recordingControlStyles.copy}>
        {t('recording.localOnly')}
      </Text>
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
      <Text
        accessibilityLiveRegion="polite"
        style={recordingControlStyles.status}
        testID="recording-status"
      >
        {recordingStatusLabel(status)}
      </Text>
      <Text style={recordingControlStyles.duration} testID="recording-duration">
        {t('recording.duration', {
          duration: formatRecordingDuration(durationMs),
        })}
      </Text>
      {status === 'idle' || status === 'completed' ? (
        <Button
          disabled={!consentAcknowledged || controlsBusy || sourceRetryPending}
          onPress={onStart}
          testID="recording-start"
          title={t('recording.start')}
        />
      ) : null}
      {status === 'recording' ? (
        <Button
          disabled={controlsBusy}
          onPress={onPause}
          testID="recording-pause"
          title={t('recording.pause')}
        />
      ) : null}
      {status === 'paused' || status === 'interrupted' ? (
        <Button
          disabled={controlsBusy}
          onPress={onResume}
          testID="recording-resume"
          title={t('recording.resume')}
        />
      ) : null}
      {status === 'recording' ||
      status === 'paused' ||
      status === 'interrupted' ? (
        <Button
          disabled={controlsBusy}
          onPress={onStop}
          testID="recording-stop"
          title={t('recording.stop')}
        />
      ) : null}
    </>
  );
}
