import { useMemo, useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import { appleOnDeviceSpeechTranscriptionProvider } from '../../src/transcription';
import {
  createTranscriptEvidenceService,
  type TranscriptEvidenceService,
} from '../../src/transcription/transcriptEvidenceService';
import {
  installSyntheticTranscriptionRecording,
  playSyntheticTranscriptionRange,
  removeSyntheticTranscriptionRecording,
} from '../../src/recording/nativeRecordingBridge';
import { openLocalStorage } from '../../src/storage/secureDatabase';
import TranscriptEvidencePanel from '../../src/transcription/TranscriptEvidencePanel';
import syntheticFixture from './fixtures/synthetic-korean.json';

const fixture = syntheticFixture as unknown as {
  readonly cases: readonly { readonly audio: { readonly base64: string } }[];
};

type SetupStatus =
  'idle' | 'preparing' | 'ready' | 'failed' | 'cleaning' | 'cleaned';

function createProbeService(
  onPlayback: (result: {
    startMs: number;
    endMs: number;
    actualStartMs: number;
  }) => void,
): TranscriptEvidenceService {
  const service = createTranscriptEvidenceService({
    provider: {
      transcribeRecording: request =>
        appleOnDeviceSpeechTranscriptionProvider.transcribeRecording({
          ...request,
          syntheticFixture: true,
        }),
    },
    playRange: playSyntheticTranscriptionRange,
  });
  return {
    ...service,
    async transcribe(recordingSourceId) {
      const segments = await service.transcribe(recordingSourceId);
      const [segment] = segments;
      if (!segment)
        throw new Error('The native engine returned no transcript segment.');
      const repository = await openLocalStorage();
      await repository.put('visit_question', derivedQuestion(segment));
      return segments;
    },
    async play(segment) {
      const result = await service.play(segment);
      onPlayback(result);
      return result;
    },
  };
}

function derivedQuestion(segment: TranscriptEvidenceSegment) {
  const timestamp = new Date().toISOString();
  return {
    id: `${segment.recordingSourceId}:transcript-question`,
    effectiveAt: segment.effectiveAt,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: { origin: 'derived' as const, sourceRecordIds: [segment.id] },
    reviewState: { status: 'unreviewed' as const },
    questionText: 'Synthetic transcript evidence check',
    priority: 'important' as const,
    evidenceSpanIds: [],
  };
}

async function cleanupSyntheticRecording(
  recordingSourceId: string,
): Promise<void> {
  const repository = await openLocalStorage();
  // Remove the derived fixture before deleting its transcript source so reruns leave no orphaned artifact.
  await repository.delete(
    'visit_question',
    `${recordingSourceId}:transcript-question`,
  );
  await repository.sourceRecords.delete(recordingSourceId);
  const [source, question, transcripts, staleArtifacts] = await Promise.all([
    repository.get('source_record', recordingSourceId),
    repository.get(
      'visit_question',
      `${recordingSourceId}:transcript-question`,
    ),
    repository.transcripts.listForRecording(recordingSourceId),
    repository.transcripts.listStaleArtifacts(`${recordingSourceId}:segment:0`),
  ]);
  if (
    source ||
    question ||
    transcripts.length > 0 ||
    staleArtifacts.length > 0
  ) {
    throw new Error('Synthetic transcript records remained after cleanup.');
  }
  await removeSyntheticTranscriptionRecording(recordingSourceId);
}

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
  const [error, setError] = useState('');
  const service = useMemo(() => createProbeService(setPlayback), []);

  async function prepare(): Promise<void> {
    setStatus('preparing');
    setError('');
    let installedRecordingId: string | null = null;
    try {
      const sample = fixture.cases[0];
      if (!sample) throw new Error('The synthetic speech fixture is empty.');
      const recording = await installSyntheticTranscriptionRecording(
        sample.audio.base64,
      );
      installedRecordingId = recording.id;
      const timestamp = new Date().toISOString();
      const source: SourceRecord = {
        id: recording.id,
        sourceKind: 'audio_recording',
        effectiveAt: recording.startedAt,
        recordedAt: recording.completedAt,
        ingestedAt: timestamp,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        title: 'Synthetic transcription test recording',
      };
      const repository = await openLocalStorage();
      await repository.put('source_record', source);
      setRecordingSourceId(recording.id);
      setStatus('ready');
    } catch (failure) {
      let message =
        failure instanceof Error ? failure.message : String(failure);
      if (installedRecordingId) {
        try {
          await cleanupSyntheticRecording(installedRecordingId);
        } catch (cleanupFailure) {
          setRecordingSourceId(installedRecordingId);
          const cleanupMessage =
            cleanupFailure instanceof Error
              ? cleanupFailure.message
              : String(cleanupFailure);
          message = `${message}; fixture cleanup failed: ${cleanupMessage}`;
        }
      }
      setError(message);
      setStatus('failed');
    }
  }

  async function cleanup(): Promise<void> {
    if (!recordingSourceId) return;
    setStatus('cleaning');
    try {
      await cleanupSyntheticRecording(recordingSourceId);
      setRecordingSourceId(null);
      setStatus('cleaned');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus('failed');
    }
  }

  return (
    <View>
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
      {recordingSourceId && status === 'ready' ? (
        <>
          <TranscriptEvidencePanel
            recordingSourceId={recordingSourceId}
            service={service}
          />
          {playback ? (
            <Text testID="transcript-evidence-playback-result">
              {JSON.stringify(playback)}
            </Text>
          ) : null}
        </>
      ) : null}
      {recordingSourceId ? (
        <Button
          disabled={status === 'cleaning'}
          onPress={cleanup}
          testID="transcript-evidence-cleanup"
          title="Clean up test recording"
        />
      ) : null}
    </View>
  );
}
