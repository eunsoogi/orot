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
import { isSyntheticTranscriptionFixtureUnchanged } from '../../src/recording/syntheticRecordingExportProbeBridge';
import {
  cleanupSyntheticTranscriptRecording,
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
  type TranscriptEvidenceProbeService,
} from './transcriptEvidenceProbeSupport';
import { installAudioExportProbeDiagnostics } from './recordingExportProbeDiagnostics';
import { RecordingExportAuthorizationStatus } from './RecordingExportAuthorizationStatus';

type SetupStatus =
  'idle' | 'preparing' | 'ready' | 'failed' | 'cleaning' | 'cleaned';
type CorrectionStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function RecordingExportProbeHarness() {
  const [status, setStatus] = useState<SetupStatus>('idle');
  const [syntheticRecording, setSyntheticRecording] =
    useState<CompletedRecording | null>(null);
  const recordingSourceId = syntheticRecording?.id ?? null;
  const [playback, setPlayback] = useState<{
    startMs: number;
    endMs: number;
    actualStartMs: number;
  } | null>(null);
  const [exportResidueCount, setExportResidueCount] = useState('unknown');
  const [exportSourceStatus, setExportSourceStatus] = useState('not-checked');
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
    syntheticRecording === null
      ? null
      : {
          id: syntheticRecording.id,
          durationMs: syntheticRecording.durationMs,
          startedAt: syntheticRecording.startedAt,
          completedAt: syntheticRecording.completedAt,
          fileProtection: syntheticRecording.fileProtection,
          excludedFromBackup: syntheticRecording.excludedFromBackup,
        };

  async function prepare(): Promise<void> {
    setStatus('preparing');
    setError('');
    try {
      const recording = await prepareSyntheticTranscriptRecording();
      setSyntheticRecording(recording);
      // Seed a transcript before rendering export controls so the text action is a real share path.
      await service.transcribe(recording.id);
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
      setSyntheticRecording(null);
      setStatus('cleaned');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus('failed');
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
      if (recordingSourceId) {
        const unchanged =
          await isSyntheticTranscriptionFixtureUnchanged(recordingSourceId);
        setExportSourceStatus(unchanged ? 'unchanged' : 'changed-or-missing');
      }
    } catch (failure) {
      setExportSourceStatus('failed');
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
      <Text testID="recording-export-source-status">{exportSourceStatus}</Text>
      <RecordingExportAuthorizationStatus recordingId={recordingSourceId} />
      {syntheticRecording ? (
        // This is fixture metadata only; Simulator values are not device protection evidence.
        <Text testID="transcript-evidence-source-security">
          fixture-protection={syntheticRecording.fileProtection}{' '}
          backup-excluded=
          {String(syntheticRecording.excludedFromBackup)}
        </Text>
      ) : null}
      <Text testID="recording-export-probe-diagnostic">
        {audioExportDiagnostic}
      </Text>
      <Text testID="transcript-evidence-correction-status">
        {correctionStatus}
      </Text>
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
        // No recorder is active in this probe, so the shared async stop contract resolves without work.
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
          onStop={() => Promise.resolve()}
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
