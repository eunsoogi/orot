import { useEffect, useMemo, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import RecordingControls from '../../src/recording/RecordingControls';
import { recordingExportService } from '../../src/recording/recordingExportService';
import type { CompletedRecording } from '../../src/recording/recordingTypes';
import {
  armSyntheticExportCancellation,
  getSyntheticExportResidueCount,
  prepareSyntheticExportResidue,
} from '../../src/recording/nativeRecordingBridge';
import {
  cleanupSyntheticTranscriptRecording,
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
  type TranscriptEvidenceProbeService,
} from './transcriptEvidenceProbeSupport';
import { installAudioExportProbeDiagnostics } from './recordingExportProbeDiagnostics';

type SetupStatus =
  'idle' | 'preparing' | 'ready' | 'failed' | 'cleaning' | 'cleaned';
type CorrectionStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function TranscriptEvidenceProbe() {
  const [status, setStatus] = useState<SetupStatus>('idle');
  const [recordingSourceId, setRecordingSourceId] = useState<string | null>(
    null,
  );
  const [playback, setPlayback] = useState<{
    startMs: number;
    endMs: number;
    actualStartMs: number;
  } | null>(null);
  const [memoryStatus, setMemoryStatus] = useState('not-checked');
  const [exportResidueCount, setExportResidueCount] = useState('unknown');
  const [audioExportDiagnostic, setAudioExportDiagnostic] =
    useState('not-observed');
  const [correctionStatus, setCorrectionStatus] =
    useState<CorrectionStatus>('idle');
  const [error, setError] = useState('');
  const service: TranscriptEvidenceProbeService = useMemo(
    () =>
      createTranscriptEvidenceProbeService(setPlayback, setCorrectionStatus),
    [setCorrectionStatus, setPlayback],
  );
  // This probe-only wrapper records a safe rejection code and rethrows the original failure.
  useEffect(
    () =>
      installAudioExportProbeDiagnostics(
        recordingExportService,
        setAudioExportDiagnostic,
      ),
    [setAudioExportDiagnostic],
  );
  const syntheticCompletedRecording: CompletedRecording | null =
    recordingSourceId === null
      ? null
      : {
          id: recordingSourceId,
          durationMs: 5_000,
          startedAt: '2026-10-07T00:00:00.000Z',
          completedAt: '2026-10-07T00:00:05.000Z',
          fileProtection: 'complete',
          excludedFromBackup: true,
        };

  async function prepare(): Promise<void> {
    setStatus('preparing');
    setError('');
    try {
      setRecordingSourceId(await prepareSyntheticTranscriptRecording());
      setStatus('ready');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus('failed');
    }
  }

  async function cleanup(): Promise<void> {
    if (!recordingSourceId) return;
    setStatus('cleaning');
    try {
      await cleanupSyntheticTranscriptRecording(recordingSourceId);
      setRecordingSourceId(null);
      setStatus('cleaned');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus('failed');
    }
  }

  async function verifyMemoryInvalidation(): Promise<void> {
    setMemoryStatus('checking');
    setError('');
    try {
      await service.verifyMemoryInvalidation();
      setMemoryStatus('passed');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setMemoryStatus('failed');
    }
  }

  async function prepareExportResidue(): Promise<void> {
    try {
      setExportResidueCount(String(await prepareSyntheticExportResidue()));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function refreshExportResidue(): Promise<void> {
    try {
      setExportResidueCount(String(await getSyntheticExportResidueCount()));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function armExportCancellation(): Promise<void> {
    try {
      await armSyntheticExportCancellation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <View style={recordingSourceId ? styles.recordingScreen : undefined}>
      <Button
        disabled={
          status === 'preparing' ||
          status === 'cleaning' ||
          status === 'cleaned' ||
          recordingSourceId !== null
        }
        onPress={prepare}
        testID="transcript-evidence-open"
        title="Open transcript evidence check"
      />
      <Text testID="transcript-evidence-setup-status">{status}</Text>
      {error ? (
        <Text testID="transcript-evidence-setup-error">{error}</Text>
      ) : null}
      <Text testID="transcript-evidence-cleanup-available">
        {recordingSourceId ? 'yes' : 'no'}
      </Text>
      <Text testID="transcript-evidence-memory-status">{memoryStatus}</Text>
      {/* Simulator-only controls verify cleanup of temporary export files across a fresh app process. */}
      <Button
        onPress={prepareExportResidue}
        testID="recording-export-prepare-residue"
        title="Prepare interrupted export cleanup"
      />
      <Button
        onPress={refreshExportResidue}
        testID="recording-export-read-residue"
        title="Read export temp files"
      />
      <Button
        onPress={armExportCancellation}
        testID="recording-export-arm-simulated-cancel"
        title="Simulate export cancellation"
      />
      <Text testID="recording-export-residue-count">{exportResidueCount}</Text>
      <Text testID="recording-export-probe-diagnostic">
        {audioExportDiagnostic}
      </Text>
      <Text testID="transcript-evidence-correction-status">
        {correctionStatus}
      </Text>
      {recordingSourceId ? (
        <Button
          disabled={memoryStatus === 'checking' || memoryStatus === 'passed'}
          onPress={verifyMemoryInvalidation}
          testID="transcript-evidence-verify-memory"
          title="Verify transcript memory invalidation"
        />
      ) : null}
      {playback ? (
        <Text testID="transcript-evidence-playback-result">
          {JSON.stringify(playback)}
        </Text>
      ) : null}
      {recordingSourceId ? (
        <Button
          disabled={status === 'cleaning'}
          onPress={cleanup}
          testID="transcript-evidence-cleanup"
          title="Clean up test recording"
        />
      ) : null}
      {recordingSourceId &&
      status === 'ready' &&
      syntheticCompletedRecording ? (
        // A completed synthetic recording drives the same controls branch as a saved user recording.
        <RecordingControls
          onBack={() => {}}
          stateReady
          status="completed"
          durationMs={syntheticCompletedRecording.durationMs}
          consentAcknowledged
          onToggleConsent={() => {}}
          busy={false}
          onStart={() => {}}
          onPause={() => {}}
          onResume={() => {}}
          onStop={() => {}}
          lastRecording={syntheticCompletedRecording}
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
    </View>
  );
}

const styles = StyleSheet.create({
  // Keep production recording controls in a bounded parent so Detox can reach export actions on short screens.
  recordingScreen: { flex: 1, width: '100%' },
});
