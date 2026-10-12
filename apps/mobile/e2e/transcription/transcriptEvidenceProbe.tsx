import { useEffect, useMemo, useState } from 'react';
import { Button, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import RecordingScreen from '../../src/recording/RecordingScreen';
import { probeSourceIdentifier } from './transcriptProbeSettings';
import {
  cleanupSyntheticTranscriptRecording,
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
  type TranscriptEvidenceProbeService,
} from './transcriptEvidenceProbeSupport';
import {
  seedTranscriptDeletionEvidence,
  verifyTranscriptDeletionAfterRelaunch,
} from './transcriptDeletionProbeSupport';

type SetupStatus =
  'idle' | 'preparing' | 'ready' | 'failed' | 'cleaning' | 'cleaned';
type CorrectionStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function TranscriptEvidenceProbe() {
  const deletionVerificationId = probeSourceIdentifier(
    'OROT_TRANSCRIPT_DELETION_VERIFY_SOURCE_ID',
  );
  const cleanupSourceId = probeSourceIdentifier(
    'OROT_TEST_TRANSCRIPT_CLEANUP_ID',
  );
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
  const [correctionStatus, setCorrectionStatus] =
    useState<CorrectionStatus>('idle');
  const [deletionSeedStatus, setDeletionSeedStatus] = useState('not-seeded');
  const [deletionStatus, setDeletionStatus] = useState(
    deletionVerificationId ? 'checking' : 'not-requested',
  );
  const [error, setError] = useState('');
  const service: TranscriptEvidenceProbeService = useMemo(() => {
    const delegate = createTranscriptEvidenceProbeService(
      setPlayback,
      setCorrectionStatus,
    );
    return {
      ...delegate,
      async transcribe(id: string) {
        try {
          return await delegate.transcribe(id);
        } catch (failure) {
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
          throw failure;
        }
      },
    };
  }, [setCorrectionStatus, setPlayback]);
  // On relaunch, wait for persisted deletion checks before opening the real recording list.
  const showRecordingScreen = Boolean(
    (recordingSourceId && status === 'ready') ||
    (deletionVerificationId && deletionStatus === 'passed'),
  );

  useEffect(() => {
    if (!cleanupSourceId) return;
    // A failed UI assertion still owns its UUID fixture; never reset another case's database.
    if (!/^[a-f0-9-]{36}$/i.test(cleanupSourceId)) {
      setStatus('failed');
      return;
    }
    setStatus('cleaning');
    cleanupSyntheticTranscriptRecording(cleanupSourceId).then(
      () => {
        setStatus('cleaned');
        console.info('TRANSCRIPT_FIXTURE_CLEANUP_COMPLETE', cleanupSourceId);
      },
      failure => {
        setStatus('failed');
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  }, [cleanupSourceId]);

  useEffect(() => {
    if (!deletionVerificationId) return;
    let active = true;
    verifyTranscriptDeletionAfterRelaunch(deletionVerificationId).then(
      () => {
        if (active) setDeletionStatus('passed');
      },
      failure => {
        console.error(
          'TRANSCRIPT_DELETION_RELAUNCH_VERIFICATION_FAILED',
          failure instanceof Error ? failure.message : String(failure),
        );
        if (active) setDeletionStatus('failed');
      },
    );
    return () => {
      active = false;
    };
  }, [deletionVerificationId]);

  async function prepare(): Promise<void> {
    setStatus('preparing');
    setError('');
    try {
      // Cleanup and recording queries use the fixture's stable source ID.
      const recording = await prepareSyntheticTranscriptRecording();
      setRecordingSourceId(recording.id);
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

  async function seedDeletionEvidence(): Promise<void> {
    if (!recordingSourceId) return;
    setDeletionSeedStatus('seeding');
    setError('');
    try {
      await seedTranscriptDeletionEvidence(recordingSourceId);
      setDeletionSeedStatus('seeded');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setDeletionSeedStatus('failed');
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.recordingScreen}>
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
        <Text testID="transcript-evidence-source-id">
          {recordingSourceId ?? ''}
        </Text>
        <Text testID="transcript-evidence-deletion-seed-status">
          {deletionSeedStatus}
        </Text>
        <Text testID="transcript-evidence-deletion-status">
          {deletionStatus}
        </Text>
        <Text testID="transcript-evidence-memory-status">{memoryStatus}</Text>
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
        {recordingSourceId ? (
          <Button
            disabled={
              deletionSeedStatus === 'seeding' ||
              deletionSeedStatus === 'seeded'
            }
            onPress={seedDeletionEvidence}
            testID="transcript-evidence-seed-deletion"
            title="Seed deletion search evidence"
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
        {showRecordingScreen ? (
          <RecordingScreen onBack={() => {}} transcriptService={service} />
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // Keep test actions below system insets and give the production screen a bounded scroll viewport.
  recordingScreen: { flex: 1, width: '100%' },
});
