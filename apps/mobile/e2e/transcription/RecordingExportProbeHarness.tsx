import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import RecordingLibraryPanel from '../../src/recording/RecordingLibraryPanel';
import RecordingExportPanel from '../../src/recording/RecordingExportPanel';
import { recordingLibraryService } from '../../src/recording/recordingLibraryService';
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
import { probeSourceIdentifier } from './transcriptProbeSettings';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/** Keeps only the actual audio share gesture in UI; interrupted-export and synthetic-cancel matrices run in native integration. */
export function RecordingExportProbeHarness() {
  const [status, setStatus] = useState('preparing');
  const [recording, setRecording] = useState<CompletedRecording | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const backgroundSourceId = probeSourceIdentifier(
    'OROT_TEST_EXPORT_BACKGROUND_SOURCE_ID',
  );
  // Show this case's two real persisted sources. Older suites' fixtures must not move
  // the intended backdrop row offscreen, and remain untouched in the shared test database.
  const library = useMemo(
    () => ({
      ...recordingLibraryService,
      listSummaries: async () =>
        (await recordingLibraryService.listSummaries!()).filter(
          item =>
            item.source.id === recording?.id ||
            item.source.id === backgroundSourceId,
        ),
    }),
    [recording?.id, backgroundSourceId],
  );
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
          // Only the library and export components participate in this regression. Keeping
          // the unrelated session controls out preserves a visible real row behind the sheet.
          <ScrollView
            testID="recording-controls-scroll"
            contentContainerStyle={styles.content}
          >
            <RecordingLibraryPanel
              service={library}
              transcriptService={service}
              actionsDisabled={exportBusy}
            />
            <RecordingExportPanel
              recordingSourceId={recording.id}
              transcriptService={service}
              onBusyChange={setExportBusy}
            />
          </ScrollView>
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
  content: { padding: 20, gap: 16 },
  observation: { position: 'absolute', top: 0, left: 0 },
  marker: { fontSize: 1 },
});
