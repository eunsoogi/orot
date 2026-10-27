import { Pressable, View, useWindowDimensions } from 'react-native';
import { ComposerGlassBackground } from '../ragConversation/ComposerGlassBackground';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import RecordingWaveform from './RecordingWaveform';
import { recordingSessionStyles as styles } from './RecordingSessionPanel.styles';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { recordingControlStyles } from './RecordingControls.styles';
import { recordingStatusLabel } from './recordingStatusLabel';
import {
  formatRecordingDuration,
  type RecordingStatus,
} from './recordingTypes';

interface RecordingSessionPanelProps {
  status: RecordingStatus;
  durationMs: number;
  amplitude?: number;
  consentAcknowledged: boolean;
  controlsBusy: boolean;
  sourceRetryPending: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => Promise<void>;
}

// Live status and capture controls stay mounted together; consent and its guidance live in the sibling panel.
export default function RecordingSessionPanel({
  status,
  durationMs,
  amplitude,
  consentAcknowledged,
  controlsBusy,
  sourceRetryPending,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordingSessionPanelProps) {
  const compact = useWindowDimensions().width < 375;
  return (
    <View style={styles.panel} testID="recording-session-panel">
      <View style={styles.session}>
        <View style={recordingControlStyles.recordingStatus}>
          {status === 'recording' ? (
            <View style={recordingControlStyles.liveDot} />
          ) : null}
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.status,
              status === 'recording' ? recordingControlStyles.liveStatus : null,
            ]}
            testID="recording-status"
          >
            {recordingStatusLabel(status)}
          </Text>
        </View>
        <Text
          accessibilityLabel={t('recording.duration', {
            duration: formatRecordingDuration(durationMs),
          })}
          adjustsFontSizeToFit
          numberOfLines={1}
          style={styles.duration}
          testID="recording-duration"
        >
          {formatRecordingDuration(durationMs)}
        </Text>
        <RecordingWaveform
          amplitude={amplitude}
          durationMs={durationMs}
          status={status}
        />
      </View>
      {/* One large microphone starts or finishes a take; the small icon changes only pause/resume state. */}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={
            status === 'idle' || status === 'completed'
              ? t('recording.start')
              : t('recording.stop')
          }
          accessibilityRole="button"
          accessibilityState={{
            disabled:
              controlsBusy ||
              sourceRetryPending ||
              ((status === 'idle' || status === 'completed') &&
                !consentAcknowledged),
          }}
          disabled={
            controlsBusy ||
            sourceRetryPending ||
            ((status === 'idle' || status === 'completed') &&
              !consentAcknowledged)
          }
          onPress={
            status === 'idle' || status === 'completed' ? onStart : onStop
          }
          style={[styles.microphone, compact && styles.compactMicrophone]}
          testID="recording-microphone-control"
        >
          <View
            style={[
              styles.microphoneInner,
              compact && styles.compactMicrophoneInner,
            ]}
          >
            <AppSymbol name="mic.fill" size={52} color={appColors.onPrimary} />
          </View>
        </Pressable>
        {status === 'recording' ? (
          <Pressable
            accessibilityLabel={t('recording.pauseAccessibility')}
            accessibilityRole="button"
            accessibilityState={{ disabled: controlsBusy }}
            disabled={controlsBusy}
            onPress={onPause}
            style={[
              styles.secondaryAction,
              compact && styles.compactSecondaryAction,
            ]}
            testID="recording-pause"
          >
            <ComposerGlassBackground />
            <AppSymbol
              name="pause.fill"
              size={27}
              color={appColors.primaryText}
            />
          </Pressable>
        ) : status === 'paused' || status === 'interrupted' ? (
          <Pressable
            accessibilityLabel={t('recording.resume')}
            accessibilityRole="button"
            accessibilityState={{ disabled: controlsBusy }}
            disabled={controlsBusy}
            onPress={onResume}
            style={[
              styles.secondaryAction,
              compact && styles.compactSecondaryAction,
            ]}
            testID="recording-resume"
          >
            <ComposerGlassBackground />
            <AppSymbol
              name="play.fill"
              size={27}
              color={appColors.primaryText}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
