import { useMemo, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import RecordingScreen from '../../src/recording/RecordingScreen';
import {
  cleanupSyntheticTranscriptRecording,
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
  type TranscriptEvidenceProbeService,
} from './transcriptEvidenceProbeSupport';

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
  const [correctionStatus, setCorrectionStatus] =
    useState<CorrectionStatus>('idle');
  const [error, setError] = useState('');
  const service: TranscriptEvidenceProbeService = useMemo(
    () =>
      createTranscriptEvidenceProbeService(setPlayback, setCorrectionStatus),
    [setCorrectionStatus, setPlayback],
  );

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
      {recordingSourceId && status === 'ready' ? (
        <RecordingScreen onBack={() => {}} transcriptService={service} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Give the production screen a bounded parent so its own recording-controls scroll can reach the transcript.
  recordingScreen: { flex: 1, width: '100%' },
});
