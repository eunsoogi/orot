import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RecordingControls from '../../src/recording/RecordingControls';
import { recordingExportService } from '../../src/recording/recordingExportService';
import type { CompletedRecording } from '../../src/recording/recordingTypes';
import { getSyntheticExportResidueCount } from '../../src/recording/nativeRecordingBridge';
import { isSyntheticTranscriptionFixtureUnchanged } from '../../src/recording/syntheticRecordingExportProbeBridge';
import {
  cleanupSyntheticTranscriptRecording,
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
} from './transcriptEvidenceProbeSupport';
import { installAudioExportProbeDiagnostics } from './recordingExportProbeDiagnostics';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/** Keeps only the actual audio share gesture in UI; interrupted-export and synthetic-cancel matrices run in native integration. */
export function RecordingExportProbeHarness() {
  const [status, setStatus] = useState('preparing');
  const [recording, setRecording] = useState<CompletedRecording | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const service = useMemo(
    () =>
      createTranscriptEvidenceProbeService(
        () => {},
        () => {},
      ),
    [],
  );

  useEffect(() => {
    const restoreDiagnostics = installAudioExportProbeDiagnostics(
      recordingExportService,
      setError,
    );
    const original = recordingExportService.shareAudio;
    const observed: typeof original = async id => {
      const value = await original(id);
      // Read real native state after UIKit's completion and before removing this case's source.
      const residueCount = await getSyntheticExportResidueCount();
      const sourceUnchanged =
        await isSyntheticTranscriptionFixtureUnchanged(id);
      await cleanupSyntheticTranscriptRecording(id);
      setResult(
        JSON.stringify({ residueCount, sourceUnchanged, cleaned: true }),
      );
      return value;
    };
    recordingExportService.shareAudio = observed;
    let active = true;
    prepareSyntheticTranscriptRecording().then(
      value => {
        if (active) {
          setRecording(value);
          setStatus('ready');
        }
      },
      failure => {
        if (active) {
          setError(String(failure));
          setStatus('failed');
        }
      },
    );
    return () => {
      active = false;
      if (recordingExportService.shareAudio === observed)
        recordingExportService.shareAudio = original;
      restoreDiagnostics();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        {recording && status === 'ready' ? (
          <RecordingControls
            onBack={() => {}}
            stateReady
            status="completed"
            durationMs={recording.durationMs}
            consentAcknowledged
            onToggleConsent={() => {}}
            busy={false}
            onStart={() => {}}
            onPause={() => {}}
            onResume={() => {}}
            onStop={() => Promise.resolve()}
            lastRecording={recording}
            sourceSaved
            onRetrySourceSave={() => {}}
            error=""
            syntheticProbeAvailable={false}
            syntheticProbeReady={false}
            onPrepareSyntheticProbe={() => {}}
            onPrepareSyntheticStartFailure={() => {}}
            onSendInterruption={() => {}}
            probeError=""
            transcriptService={service}
          />
        ) : null}
        <View pointerEvents="none" style={styles.observation}>
          <Text style={styles.marker} testID="transcript-evidence-setup-status">
            {status}
          </Text>
          <Text style={styles.marker} testID="recording-export-source-id">
            {recording?.id ?? ''}
          </Text>
          <Text
            style={styles.marker}
            testID="recording-export-result"
            accessibilityLabel={result}
          >
            export result
          </Text>
          <Text
            style={styles.marker}
            testID="recording-export-probe-diagnostic"
            accessibilityLabel={error}
          >
            error
          </Text>
          <Text
            style={styles.marker}
            testID="transcript-evidence-source-security"
          >
            backup-excluded={String(recording?.excludedFromBackup)}
          </Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  observation: { position: 'absolute', top: 0, left: 0 },
  marker: { fontSize: 1 },
});
