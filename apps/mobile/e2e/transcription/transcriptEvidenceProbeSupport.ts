import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { AgentMemoryInput } from '@orot/agent-memory';
import { deterministicProvider } from '../../src/memory/agentMemoryProbe';
import {
  closeLocalAgentMemory,
  openLocalAgentMemory,
} from '../../src/memory/localAgentMemory';
import {
  installSyntheticTranscriptionRecording,
  playSyntheticTranscriptionRange,
  removeSyntheticTranscriptionRecording,
} from '../../src/recording/nativeRecordingBridge';
import { createTranscriptEvidenceService } from '../../src/transcription/transcriptEvidenceService';
import type { TranscriptEvidenceService } from '../../src/transcription/transcriptEvidenceService';
import { openLocalStorage } from '../../src/storage/secureDatabase';
import syntheticFixture from './fixtures/synthetic-korean.json';

const fixture = syntheticFixture as unknown as {
  readonly cases: readonly { readonly audio: { readonly base64: string } }[];
};
const recordingDurations = new Map<string, number>();

type PlaybackReport = {
  startMs: number;
  endMs: number;
  actualStartMs: number;
};

function transcriptFixture(
  source: SourceRecord,
  durationMs: number,
): TranscriptEvidenceSegment {
  const recordedAt = new Date().toISOString();
  const transcriptId = `${source.id}:segment:0`;
  const audioRange = { startMs: 250, endMs: 1801 };
  if (audioRange.endMs > durationMs)
    throw new Error(
      'The synthetic audio is too short for the transcript range.',
    );
  return {
    id: `${transcriptId}:r1`,
    transcriptId,
    recordingSourceId: source.id,
    segmentOrdinal: 0,
    revision: 1,
    text: '합성 전사 원문입니다.',
    language: 'ko-KR',
    recordingDurationMs: durationMs,
    audioRange,
    effectiveAt: new Date(
      Date.parse(source.effectiveAt) + audioRange.startMs,
    ).toISOString(),
    recordedAt,
    ingestedAt: recordedAt,
    provenance: {
      origin: 'derived',
      sourceRecordIds: [source.id],
      source: {
        system: 'E2E synthetic transcript fixture',
        sourceIdentifier: 'synthetic-fixture-adapter',
        sourceVersion: 'fixture-v1',
      },
    },
    reviewState: { status: 'unreviewed' },
  };
}

function syntheticConfirmedMemory(
  segment: TranscriptEvidenceSegment,
): AgentMemoryInput {
  // This test-only record models a prior user-confirmed memory linked to the transcript revision.
  return {
    memoryKey: `transcript-probe:${segment.transcriptId}`,
    text: segment.text,
    kind: 'reviewed_interaction',
    provenance: {
      sourceIds: [segment.id],
      sourceDates: [{ sourceId: segment.id, date: segment.recordedAt }],
      reviewState: 'user_confirmed',
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

export type TranscriptEvidenceProbeService = TranscriptEvidenceService & {
  verifyMemoryInvalidation(): Promise<void>;
};

export function createTranscriptEvidenceProbeService(
  onPlayback: (result: PlaybackReport) => void,
  onCorrectionStatus: (status: 'saving' | 'saved' | 'failed') => void,
): TranscriptEvidenceProbeService {
  let originalMemory: AgentMemoryInput | null = null;
  const service = createTranscriptEvidenceService({
    playRange: playSyntheticTranscriptionRange,
  });
  return {
    ...service,
    async transcribe(recordingSourceId) {
      const repository = await openLocalStorage();
      const existing =
        await repository.transcripts.listForRecording(recordingSourceId);
      if (existing.length > 0) return existing;
      const source = await repository.get('source_record', recordingSourceId);
      if (!source || source.sourceKind !== 'audio_recording')
        throw new Error('The synthetic transcript source was not saved.');
      const durationMs = recordingDurations.get(recordingSourceId);
      if (!durationMs)
        throw new Error('The synthetic recording duration is unavailable.');
      const segment = transcriptFixture(source, durationMs);
      await repository.transcripts.append([segment]);
      const memoryInput = syntheticConfirmedMemory(segment);
      originalMemory = memoryInput;
      const memory = await openLocalAgentMemory(deterministicProvider);
      await memory.remember(memoryInput);
      if (
        (await memory.recall(segment.text, { minSimilarity: 0.999 })).length !==
        1
      ) {
        throw new Error('The synthetic transcript memory was not recalled.');
      }
      await repository.put('visit_question', derivedQuestion(segment));
      return repository.transcripts.listForRecording(recordingSourceId);
    },
    async correct(segmentId, text) {
      onCorrectionStatus('saving');
      try {
        // Keep memory restart assertions outside this save operation so the probe can observe persistence separately.
        const corrected = await service.correct(segmentId, text);
        onCorrectionStatus('saved');
        return corrected;
      } catch (error) {
        onCorrectionStatus('failed');
        throw error;
      }
    },
    async verifyMemoryInvalidation() {
      const priorMemory = originalMemory;
      if (!priorMemory)
        throw new Error('The synthetic transcript memory was not prepared.');
      const memory = await openLocalAgentMemory(deterministicProvider);
      if (
        (await memory.recall(priorMemory.text, { minSimilarity: 0.999 }))
          .length !== 0
      ) {
        throw new Error('The superseded transcript memory remained visible.');
      }
      await closeLocalAgentMemory();
      const reopened = await openLocalAgentMemory(deterministicProvider);
      if (
        (await reopened.recall(priorMemory.text, { minSimilarity: 0.999 }))
          .length !== 0
      ) {
        throw new Error(
          'The superseded transcript memory returned after reopening.',
        );
      }
      let staleWriteRejected = false;
      try {
        await reopened.remember(priorMemory);
      } catch (failure) {
        staleWriteRejected =
          failure instanceof Error &&
          failure.message.includes('superseded transcript revision');
      }
      if (!staleWriteRejected)
        throw new Error('A superseded transcript revision accepted memory.');
    },
    async play(segment) {
      const result = await service.play(segment);
      onPlayback(result);
      return result;
    },
  };
}

export async function prepareSyntheticTranscriptRecording(): Promise<string> {
  const sample = fixture.cases[0];
  if (!sample) throw new Error('The synthetic speech fixture is empty.');
  const recording = await installSyntheticTranscriptionRecording(
    sample.audio.base64,
  );
  recordingDurations.set(recording.id, recording.durationMs);
  try {
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
    return recording.id;
  } catch (error) {
    recordingDurations.delete(recording.id);
    await removeSyntheticTranscriptionRecording(recording.id);
    throw error;
  }
}

export async function cleanupSyntheticTranscriptRecording(
  recordingSourceId: string,
): Promise<void> {
  const repository = await openLocalStorage();
  const transcriptSegments =
    await repository.transcripts.listForRecording(recordingSourceId);
  await closeLocalAgentMemory();
  const memory = await openLocalAgentMemory(deterministicProvider);
  for (const segment of transcriptSegments)
    await memory.forgetBySourceId(segment.id);
  await closeLocalAgentMemory();
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
  if (source || question || transcripts.length > 0 || staleArtifacts.length > 0)
    throw new Error('Synthetic transcript records remained after cleanup.');
  await removeSyntheticTranscriptionRecording(recordingSourceId);
  recordingDurations.delete(recordingSourceId);
}
