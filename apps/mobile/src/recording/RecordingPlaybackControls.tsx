import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import {
  formatRecordingDuration,
  type RecordingPlaybackService,
  type RecordingPlaybackState,
} from './recordingTypes';

interface RecordingPlaybackControlsProps {
  readonly recordingId: string;
  readonly durationMs: number | null;
  readonly playbackService: RecordingPlaybackService;
  readonly autoPlay?: boolean;
  readonly onAutoPlayConsumed?: () => void;
  readonly active?: boolean;
}

const idlePlayback: RecordingPlaybackState = {
  status: 'idle',
  recordingId: null,
  positionMs: 0,
  durationMs: 0,
};

function playbackErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  if (code === 'RECORDING_FILE_MISSING')
    return t('recording.library.playbackMissing');
  if (code === 'RECORDING_FILE_INVALID')
    return t('recording.library.playbackInvalid');
  if (
    code === 'RECORDING_PLAYBACK_INTERRUPTED' ||
    code === 'RECORDING_PLAYBACK_ROUTE_CHANGED'
  ) {
    return t('recording.library.playbackInterrupted');
  }
  return t('recording.library.playbackError');
}

/** Renders player time and controls from AVAudioPlayer state, keeping the recording file in native storage. */
export default function RecordingPlaybackControls({
  recordingId,
  durationMs,
  playbackService,
  autoPlay = false,
  onAutoPlayConsumed,
  active = true,
}: RecordingPlaybackControlsProps) {
  const autoPlayStarted = useRef(false);
  const requestGeneration = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [localPlaying, setLocalPlaying] = useState(false);
  const [playbackState, setPlaybackState] =
    useState<RecordingPlaybackState>(idlePlayback);
  const [error, setError] = useState<string | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  useEffect(() => {
    setFileDuration(null);
    setLocalPlaying(false);
    setPlaybackState(idlePlayback);
    setError(null);
    return () => {
      requestGeneration.current += 1;
    };
  }, [recordingId, playbackService, active]);
  const playing =
    localPlaying ||
    (playbackState.status === 'playing' &&
      playbackState.recordingId === recordingId);
  const canPlay =
    active &&
    !playing &&
    (Boolean(playbackService.readDuration) ||
      (durationMs !== null && durationMs > 0));

  useEffect(
    () => playbackService.subscribePlayback?.(setPlaybackState),
    [playbackService],
  );

  const playRecording = useCallback(async (): Promise<void> => {
    if (!canPlay) return;
    const generation = ++requestGeneration.current;
    setLocalPlaying(true);
    setError(null);
    try {
      // Whole-recording playback uses the file clock, never a wall-clock estimate or transcript availability.
      const actualDuration = playbackService.readDuration
        ? await playbackService.readDuration(recordingId)
        : durationMs;
      // Stop, replacement, unmount, or a retained route losing focus cancels pending dispatch.
      if (!activeRef.current || generation !== requestGeneration.current)
        return;
      if (
        actualDuration === null ||
        !Number.isFinite(actualDuration) ||
        actualDuration <= 0
      )
        throw new Error('Invalid saved audio duration.');
      setFileDuration(actualDuration);
      await playbackService.playRange(recordingId, 0, actualDuration);
    } catch (failure) {
      if (generation !== requestGeneration.current) return;
      setError(playbackErrorMessage(failure));
      setPlaybackState(idlePlayback);
    } finally {
      if (generation === requestGeneration.current) setLocalPlaying(false);
    }
  }, [canPlay, durationMs, playbackService, recordingId]);

  useEffect(() => {
    if (!autoPlay) {
      autoPlayStarted.current = false;
      return;
    }
    if (autoPlayStarted.current) return;
    autoPlayStarted.current = true;
    onAutoPlayConsumed?.();
    playRecording();
  }, [autoPlay, onAutoPlayConsumed, playRecording]);

  async function stopRecording(): Promise<void> {
    if (!playbackService.stopPlayback) return;
    requestGeneration.current += 1;
    setLocalPlaying(false);
    try {
      await playbackService.stopPlayback();
    } catch (failure) {
      setError(playbackErrorMessage(failure));
    }
  }

  const activePlayback =
    playbackState.status === 'playing' &&
    playbackState.recordingId === recordingId;
  const activeDuration =
    activePlayback && playbackState.durationMs > 0
      ? playbackState.durationMs
      : (fileDuration ?? durationMs ?? 0);
  const position = activePlayback ? playbackState.positionMs : 0;
  const progress =
    activeDuration > 0 ? Math.min(100, (position / activeDuration) * 100) : 0;
  const durationLabel =
    fileDuration === null && durationMs === null
      ? t('recording.library.durationUnavailable')
      : formatRecordingDuration(fileDuration ?? durationMs ?? 0);

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
          onPress={() => {
            playRecording();
          }}
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
        {playing && playbackService.stopPlayback ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('recording.library.stopAudio')}
            onPress={() => {
              stopRecording();
            }}
            style={styles.playbackButton}
            testID="recording-playback-stop"
          >
            <AppSymbol name="stop.fill" size={20} color={appColors.onPrimary} />
          </Pressable>
        ) : null}
        <AppSymbol name="waveform" size={24} color={appColors.primaryText} />
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: activeDuration,
          now: Math.min(position, activeDuration),
        }}
        style={styles.progressTrack}
        testID="recording-playback-progress"
      >
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <View style={styles.playbackTimes}>
        <Text style={styles.copy} testID="recording-playback-position">
          {formatRecordingDuration(position)}
        </Text>
        <Text style={styles.copy} testID="recording-detail-duration">
          {activePlayback
            ? formatRecordingDuration(activeDuration)
            : durationLabel}
        </Text>
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="recording-playback-error"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
