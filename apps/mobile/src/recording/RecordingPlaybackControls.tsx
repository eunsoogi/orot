import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import { formatRecordingDuration } from './recordingTypes';
import type { RecordingService } from './recordingTypes';

interface RecordingPlaybackControlsProps {
  readonly recordingId: string;
  readonly durationMs: number | null;
  readonly playbackService: Pick<RecordingService, 'playRange'>;
}

/** Uses the protected native audio file and only enables playback with a measured duration. */
export default function RecordingPlaybackControls({
  recordingId,
  durationMs,
  playbackService,
}: RecordingPlaybackControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const canPlay = durationMs !== null && durationMs > 0 && !playing;

  async function playRecording(): Promise<void> {
    if (!canPlay || durationMs === null) return;
    setPlaying(true);
    setError(false);
    try {
      await playbackService.playRange(recordingId, 0, durationMs);
    } catch {
      setError(true);
    } finally {
      setPlaying(false);
    }
  }

  const durationLabel =
    durationMs === null
      ? t('recording.library.durationUnavailable')
      : formatRecordingDuration(durationMs);

  return (
    <View style={styles.playbackCard} testID="recording-playback-controls">
      <View style={styles.playbackRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            playing
              ? t('recording.library.playingAudio')
              : t('recording.library.playAudio')
          }
          accessibilityState={{ disabled: !canPlay }}
          disabled={!canPlay}
          onPress={() => void playRecording()}
          style={styles.playbackButton}
          testID="recording-playback-button"
        >
          <AppSymbol
            name={playing ? 'waveform' : 'play.fill'}
            size={22}
            color={appColors.onPrimary}
          />
        </Pressable>
        <Text style={styles.playbackCopy}>
          {playing
            ? t('recording.library.playingAudio')
            : t('recording.library.playAudio')}
        </Text>
        <AppSymbol name="waveform" size={24} color={appColors.primaryText} />
      </View>
      <View style={styles.playbackTimes}>
        <Text style={styles.copy}>00:00</Text>
        <Text style={styles.copy} testID="recording-detail-duration">
          {durationLabel}
        </Text>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('recording.library.playbackError')}
        </Text>
      ) : null}
    </View>
  );
}
