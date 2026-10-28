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
  RecordingDeletionTimingProbe,
  type RecordingDeletionTimingReport,
} from '../../src/recording/recordingDeletionTimingProbe';
import {
  RecordingDeletionObservations,
  RecordingDeletionScenarioControls,
  useRecordingDeletionScenario,
} from './recordingDeletionScenarioSupport';
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
  const [deletionPersistenceStatus, setDeletionPersistenceStatus] = useState<
    string | null
  >(null);
  const [deletionTimingReport, setDeletionTimingReport] =
    useState<RecordingDeletionTimingReport | null>(null);
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
  const deletionTimingEnabled =
    settingsManager?.settings?.OROT_RECORDING_DELETION_TIMING === 'YES' ||
    settingsManager?.getConstants?.().settings
      ?.OROT_RECORDING_DELETION_TIMING === 'YES';
  // This mode checks persisted deletion after a process restart without reseeding the disposable source.
  const deletionPersistenceEnabled =
    settingsManager?.settings?.OROT_RECORDING_DELETION_PERSISTENCE_PROBE ===
      'YES' ||
    settingsManager?.getConstants?.().settings
      ?.OROT_RECORDING_DELETION_PERSISTENCE_PROBE === 'YES';
  const configuredDeletionScenario =
    settingsManager?.settings?.OROT_RECORDING_DELETION_SCENARIO ??
    settingsManager?.getConstants?.().settings
      ?.OROT_RECORDING_DELETION_SCENARIO;
  const deletionScenario =
    configuredDeletionScenario === 'failure-slow-list-read' ||
    configuredDeletionScenario === 'delayed-audio-cleanup'
      ? configuredDeletionScenario
      : null;
  const deletionScenarioProbe = useRecordingDeletionScenario(deletionScenario);
  const deletionTimingProbe = useMemo(
    () =>
      deletionTimingEnabled
        ? new RecordingDeletionTimingProbe(undefined, setDeletionTimingReport)
        : null,
    [deletionTimingEnabled],
  );
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
      if (configuredDeletionScenario !== undefined && !deletionScenario) {
        throw new Error('The recording deletion scenario is unsupported.');
      }
      if (deletionPersistenceEnabled) {
        const syntheticSourcePresent = (
          await recordingLibraryService.list()
        ).some(item => item.title === 'Synthetic transcription test recording');
        return {
          id: null,
          deletionPersistenceStatus: syntheticSourcePresent
            ? 'present'
            : 'absent',
        };
      }
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
          setRecordingSourceId(recording.id ?? null);
          if ('deletionPersistenceStatus' in recording) {
            setDeletionPersistenceStatus(
              recording.deletionPersistenceStatus ?? null,
            );
          }
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
  }, [
    configuredDeletionScenario,
    deletionPersistenceEnabled,
    deletionScenario,
    playbackProbeMode,
  ]);

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
  if (
    status !== 'ready' ||
    (recordingSourceId === null && !deletionPersistenceEnabled)
  ) {
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
        recordingLibraryService={deletionScenarioProbe.service}
        recordingDeletionTimingProbe={deletionTimingProbe ?? undefined}
        transcriptService={transcriptService}
        playbackService={playbackProbeEnabled ? playbackService : undefined}
      />
      <RecordingDeletionScenarioControls
        scenario={deletionScenario}
        {...deletionScenarioProbe}
      />
      {playbackProbeEnabled ? (
        <View
          accessible
          testID="recording-playback-observation"
          accessibilityLabel={JSON.stringify(playbackObservation)}
          style={styles.observation}
        />
      ) : null}
      <RecordingDeletionObservations
        timingEnabled={deletionTimingEnabled}
        timingReport={deletionTimingReport}
        persistenceEnabled={deletionPersistenceEnabled}
        persistenceStatus={deletionPersistenceStatus}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { alignSelf: 'center', flex: 1 },
  observation: { width: 1, height: 1 },
});
