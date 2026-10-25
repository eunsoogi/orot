import { useEffect, useMemo, useRef, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import RecordingScreen from '../../src/recording/RecordingScreen';
import {
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
} from './transcriptEvidenceProbeSupport';
import {
  playSyntheticTranscriptionRange,
  readSyntheticRecordingDuration,
  removeSyntheticTranscriptionRecording,
  simulateSyntheticPlaybackRouteLoss,
} from '../../src/recording/nativeRecordingBridge';
import { recordingService } from '../../src/recording/recordingService';
import { recordingLibraryService } from '../../src/recording/recordingLibraryService';
import {
  observedPlaybackService,
  type PlaybackObservation,
} from './playbackObservation';

const ignorePlayback = () => {};
const ignoreCorrectionStatus = () => {};

/** Seeds one synthetic source, then renders the production screen without probe controls. */
export function RecordingLibraryVisualProbe() {
  const routeLossRequested = useRef(false);
  const [status, setStatus] = useState('preparing');
  const [recordingSourceId, setRecordingSourceId] = useState<string | null>(
    null,
  );
  const [setupError, setSetupError] = useState('');
  const [playbackObservation, setPlaybackObservation] =
    useState<PlaybackObservation | null>(null);
  const transcriptService = useMemo(() => {
    const service = createTranscriptEvidenceProbeService(
      ignorePlayback,
      ignoreCorrectionStatus,
    );
    // A deterministic playback failure keeps the real alert visible for theme review.
    return {
      ...service,
      async play() {
        throw new Error('Synthetic playback failure for visual proof.');
      },
    };
  }, []);
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const configuredWidth =
    settingsManager?.settings?.OROT_RECORDING_VISUAL_WIDTH ??
    settingsManager?.getConstants?.().settings?.OROT_RECORDING_VISUAL_WIDTH;
  const requestedWidth = Number(configuredWidth);
  const contentWidth =
    Number.isFinite(requestedWidth) && requestedWidth > 0
      ? requestedWidth
      : '100%';
  const playbackProbeMode =
    settingsManager?.settings?.OROT_RECORDING_PLAYBACK_PROBE ??
    settingsManager?.getConstants?.().settings?.OROT_RECORDING_PLAYBACK_PROBE;
  const playbackProbeEnabled =
    playbackProbeMode === 'seed' ||
    playbackProbeMode === 'resume' ||
    playbackProbeMode === 'missing' ||
    playbackProbeMode === 'route';
  const playbackService = useMemo(
    () =>
      observedPlaybackService(
        {
          ...recordingService,
          playRange: playSyntheticTranscriptionRange,
          readDuration: readSyntheticRecordingDuration,
        },
        setPlaybackObservation,
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      if (playbackProbeMode === 'resume' || playbackProbeMode === 'missing') {
        const source = (await recordingLibraryService.list()).find(
          item => item.title === 'Synthetic transcription test recording',
        );
        if (!source) {
          throw new Error('The saved synthetic recording was not restored.');
        }
        if (playbackProbeMode === 'missing') {
          await removeSyntheticTranscriptionRecording(source.id);
        }
        return { id: source.id };
      }
      return prepareSyntheticTranscriptRecording();
    };
    prepare().then(
      recording => {
        if (active) {
          setRecordingSourceId(recording.id);
          setStatus('ready');
        }
      },
      failure => {
        console.error('RECORDING_LIBRARY_VISUAL_PROBE_FAILED', failure);
        if (active) {
          setSetupError(
            failure instanceof Error ? failure.message : String(failure),
          );
          setStatus('failed');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [playbackProbeMode]);

  useEffect(() => {
    if (playbackProbeMode !== 'route') return;
    const unsubscribe = recordingService.subscribePlayback?.(state => {
      if (state.status !== 'playing' || routeLossRequested.current) return;
      routeLossRequested.current = true;
      simulateSyntheticPlaybackRouteLoss().catch(failure => {
        console.error('RECORDING_PLAYBACK_ROUTE_PROBE_FAILED', failure);
      });
    });
    if (!unsubscribe) {
      setSetupError('Native playback state events are unavailable.');
      setStatus('failed');
      return;
    }
    return unsubscribe;
  }, [playbackProbeMode]);

  // The dedicated E2E simulator is uninstalled after capture to discard fixture data.
  if (status !== 'ready' || recordingSourceId === null) {
    return (
      <Text testID="recording-library-visual-status">
        {setupError ? `${status}: ${setupError}` : status}
      </Text>
    );
  }
  return (
    <View style={[styles.viewport, { width: contentWidth }]}>
      <RecordingScreen
        onBack={() => {}}
        transcriptService={transcriptService}
        playbackService={playbackProbeEnabled ? playbackService : undefined}
      />
      {playbackProbeEnabled ? (
        <View
          accessible
          testID="recording-playback-observation"
          accessibilityLabel={JSON.stringify(playbackObservation)}
          style={styles.observation}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { alignSelf: 'center', flex: 1 },
  observation: { width: 1, height: 1 },
});
