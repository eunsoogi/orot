import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createRecordingLibraryService,
  nativeAudioDeletion,
  recordingLibraryService,
  type RecordingAudioDeletion,
  type RecordingLibraryService,
} from '../../src/recording/recordingLibraryService';
import { loadRecordingLibrarySummaries } from '../../src/recording/recordingLibraryPanelHelpers';
import type { RecordingDeletionTimingReport } from '../../src/recording/recordingDeletionTimingProbe';
import { readSyntheticRecordingDuration } from '../../src/recording/nativeRecordingBridge';

export type RecordingDeletionScenario =
  'failure-slow-list-read' | 'delayed-audio-cleanup' | null;

interface Gate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

function createGate(): Gate {
  let release = () => {};
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

/** Injects deterministic recovery waits only into the disposable Simulator fixture. */
export function useRecordingDeletionScenario(
  scenario: RecordingDeletionScenario,
) {
  const [audioRestoreStatus, setAudioRestoreStatus] = useState('pending');
  const [slowListReadStatus, setSlowListReadStatus] = useState('idle');
  const [audioCleanupStatus, setAudioCleanupStatus] = useState('idle');
  const gates = useMemo(
    () => ({ listRead: createGate(), audioCleanup: createGate() }),
    [],
  );

  const service = useMemo<RecordingLibraryService>(() => {
    if (!scenario) return recordingLibraryService;

    let deletionFailureStarted = false;
    const audioDeletion: RecordingAudioDeletion = {
      ...nativeAudioDeletion,
      async restore(sourceId) {
        await nativeAudioDeletion.restore(sourceId);
        if (scenario !== 'failure-slow-list-read') return;
        try {
          const duration = await readSyntheticRecordingDuration(sourceId);
          setAudioRestoreStatus(duration > 0 ? 'restored' : 'missing');
        } catch {
          setAudioRestoreStatus('missing');
        }
      },
      async commit(sourceId) {
        if (scenario === 'delayed-audio-cleanup') {
          setAudioCleanupStatus('waiting');
          await gates.audioCleanup.promise;
          setAudioCleanupStatus('released');
        }
        return nativeAudioDeletion.commit(sourceId);
      },
    };
    const base = createRecordingLibraryService({
      audioDeletion,
      ...(scenario === 'failure-slow-list-read'
        ? {
            removeSource: async () => {
              deletionFailureStarted = true;
              throw new Error('Synthetic source deletion failure.');
            },
          }
        : {}),
    });

    return {
      ...base,
      async listSummaries() {
        if (scenario === 'failure-slow-list-read' && deletionFailureStarted) {
          setSlowListReadStatus('waiting');
          await gates.listRead.promise;
          setSlowListReadStatus('released');
        }
        return base.listSummaries
          ? base.listSummaries()
          : loadRecordingLibrarySummaries(base);
      },
    };
  }, [gates, scenario]);

  return {
    service,
    audioRestoreStatus,
    slowListReadStatus,
    audioCleanupStatus,
    releaseSlowListRead: gates.listRead.release,
    releaseAudioCleanup: gates.audioCleanup.release,
  };
}

/** Exposes visible release controls only in the opted-in disposable Simulator fixture. */
export function RecordingDeletionScenarioControls({
  scenario,
  audioRestoreStatus,
  slowListReadStatus,
  audioCleanupStatus,
  releaseSlowListRead,
  releaseAudioCleanup,
}: ReturnType<typeof useRecordingDeletionScenario> & {
  readonly scenario: RecordingDeletionScenario;
}) {
  if (!scenario) return null;

  return (
    <View style={styles.controls} testID="recording-deletion-scenario-controls">
      {scenario === 'failure-slow-list-read' ? (
        <>
          <Text
            accessibilityLabel={audioRestoreStatus}
            testID="recording-deletion-audio-restore-status"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Release slow recording list read"
            onPress={releaseSlowListRead}
            style={styles.button}
            testID="recording-deletion-release-slow-list-read"
          >
            <Text style={styles.buttonText}>Release list read</Text>
          </Pressable>
          <Text
            accessibilityLabel={slowListReadStatus}
            testID="recording-deletion-slow-list-read-status"
          />
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Release recording audio cleanup"
            onPress={releaseAudioCleanup}
            style={styles.button}
            testID="recording-deletion-release-audio-cleanup"
          >
            <Text style={styles.buttonText}>Release audio cleanup</Text>
          </Pressable>
          <Text
            accessibilityLabel={audioCleanupStatus}
            testID="recording-deletion-audio-cleanup-status"
          />
        </>
      )}
    </View>
  );
}

/** Keeps deletion timing and restart state observable only in the opt-in Simulator fixture. */
export function RecordingDeletionObservations({
  timingEnabled,
  timingReport,
  persistenceEnabled,
  persistenceStatus,
}: {
  readonly timingEnabled: boolean;
  readonly timingReport: RecordingDeletionTimingReport | null;
  readonly persistenceEnabled: boolean;
  readonly persistenceStatus: string | null;
}) {
  return (
    <>
      {timingEnabled ? (
        <View
          accessible
          accessibilityLabel={
            timingReport ? JSON.stringify(timingReport) : 'pending'
          }
          pointerEvents="none"
          style={styles.observation}
          testID="recording-deletion-timing-report"
        />
      ) : null}
      {persistenceEnabled ? (
        <Text
          accessibilityLabel={persistenceStatus ?? 'pending'}
          style={styles.observation}
          testID="recording-deletion-persistence-status"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  controls: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    zIndex: 10,
    gap: 4,
    padding: 8,
    backgroundColor: '#ffffff',
    borderColor: '#202020',
    borderWidth: 1,
    borderRadius: 8,
  },
  button: {
    minHeight: 44,
    minWidth: 180,
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#e5e5e5',
  },
  buttonText: { color: '#202020', fontWeight: '600' },
  observation: { width: 1, height: 1 },
});
