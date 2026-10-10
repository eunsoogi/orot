import type { RecordRepository, StaleTranscriptArtifact } from '@orot/storage';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordingPlaybackRange } from '../recording/recordingTypes';
import { recordingService } from '../recording/recordingService';
import { appleOnDeviceSpeechTranscriptionProvider } from './index';
import type { AppleOnDeviceSpeechProvider } from './provider';

type RepositoryLoader = () => Promise<RecordRepository>;
type TranscriptionProvider = Pick<
  AppleOnDeviceSpeechProvider,
  'transcribeRecording'
>;
type RangePlayer = (
  recordingId: string,
  startMs: number,
  endMs: number,
) => Promise<RecordingPlaybackRange>;

export interface TranscriptRecordingView {
  readonly source: SourceRecord;
  readonly segments: readonly TranscriptEvidenceSegment[];
  readonly staleArtifacts: readonly StaleTranscriptArtifact[];
}

export interface TranscriptEvidenceService {
  load(recordingSourceId?: string): Promise<TranscriptRecordingView | null>;
  transcribe(
    recordingSourceId: string,
    signal?: AbortSignal,
  ): Promise<TranscriptEvidenceSegment[]>;
  correct(segmentId: string, text: string): Promise<TranscriptEvidenceSegment>;
  play(segment: TranscriptEvidenceSegment): Promise<RecordingPlaybackRange>;
}

async function loadLocalRepository(): Promise<RecordRepository> {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  return openLocalStorage();
}

function audioRange(
  startSeconds: number,
  endSeconds: number,
  durationMs: number,
) {
  // Floor the start and ceil the end so millisecond storage does not clip Apple's fractional-second range.
  const range = {
    startMs: Math.floor(startSeconds * 1000),
    endMs: Math.ceil(endSeconds * 1000),
  };
  if (
    range.startMs < 0 ||
    range.endMs <= range.startMs ||
    range.endMs > durationMs
  ) {
    throw new Error(
      'The native transcript range does not fit its saved recording.',
    );
  }
  return range;
}

export function createTranscriptEvidenceService(
  options: {
    loadRepository?: RepositoryLoader;
    provider?: TranscriptionProvider;
    playRange?: RangePlayer;
    now?: () => Date;
  } = {},
): TranscriptEvidenceService {
  const loadRepository = options.loadRepository ?? loadLocalRepository;
  const provider = options.provider ?? appleOnDeviceSpeechTranscriptionProvider;
  const playRange = options.playRange ?? recordingService.playRange;
  const now = options.now ?? (() => new Date());

  return {
    async load(recordingSourceId) {
      const repository = await loadRepository();
      let source = recordingSourceId
        ? await repository.get('source_record', recordingSourceId)
        : null;
      if (
        recordingSourceId &&
        (!source || source.sourceKind !== 'audio_recording')
      ) {
        throw new Error('The selected recording source does not exist.');
      }
      if (!source) {
        const sources = (await repository.list('source_record'))
          .filter(candidate => candidate.sourceKind === 'audio_recording')
          .sort(
            (left, right) =>
              Date.parse(right.recordedAt) - Date.parse(left.recordedAt),
          );
        source = sources[0] ?? null;
      }
      if (!source) return null;
      const segments = await repository.transcripts.listForRecording(source.id);
      const transcriptIds = [
        ...new Set(segments.map(segment => segment.transcriptId)),
      ];
      const staleRows = (
        await Promise.all(
          transcriptIds.map(transcriptId =>
            repository.transcripts.listStaleArtifacts(transcriptId),
          ),
        )
      ).flat();
      const staleArtifacts = [
        ...new Map(
          staleRows.map(artifact => [
            `${artifact.kind}:${artifact.id}`,
            artifact,
          ]),
        ).values(),
      ];
      return { source, segments, staleArtifacts };
    },
    async transcribe(recordingSourceId, signal) {
      const repository = await loadRepository();
      const source = await repository.get('source_record', recordingSourceId);
      if (!source || source.sourceKind !== 'audio_recording') {
        throw new Error(
          'Transcript evidence requires a saved audio recording.',
        );
      }
      const existing = await repository.transcripts.listForRecording(source.id);
      if (existing.length > 0) return existing;

      const result = await provider.transcribeRecording({
        recordingId: source.id,
        language: 'ko-KR',
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw new Error(result.error.message);
      const recognizedSegments = result.value.segments ?? [];
      if (recognizedSegments.length === 0) {
        throw new Error(
          'The on-device speech engine returned no timestamped segments.',
        );
      }
      const recordedAt = now().toISOString();
      const segments = recognizedSegments.map((segment, segmentOrdinal) => {
        const audio = audioRange(
          segment.startSeconds,
          segment.endSeconds,
          result.value.recordingDurationMs,
        );
        const transcriptId = `${source.id}:segment:${segmentOrdinal}`;
        const effectiveAt = new Date(
          Date.parse(source.effectiveAt) + audio.startMs,
        ).toISOString();
        return {
          id: `${transcriptId}:r1`,
          transcriptId,
          recordingSourceId: source.id,
          segmentOrdinal,
          revision: 1,
          text: segment.text,
          language: result.value.language ?? 'ko-KR',
          recordingDurationMs: result.value.recordingDurationMs,
          audioRange: audio,
          effectiveAt,
          recordedAt,
          ingestedAt: recordedAt,
          provenance: {
            origin: 'derived' as const,
            sourceRecordIds: [source.id],
            source: {
              system: 'Apple Speech',
              sourceIdentifier: result.value.engine,
              sourceVersion: result.value.runtimeVersion,
              productType: 'on-device-speech-transcription',
            },
          },
          reviewState: { status: 'unreviewed' as const },
        };
      });
      await repository.transcripts.append(segments);
      return repository.transcripts.listForRecording(source.id);
    },
    async correct(segmentId, text) {
      const repository = await loadRepository();
      return repository.transcripts.correct(
        segmentId,
        text,
        now().toISOString(),
      );
    },
    play(segment) {
      return playRange(
        segment.recordingSourceId,
        segment.audioRange.startMs,
        segment.audioRange.endMs,
      );
    },
  };
}

export const transcriptEvidenceService = createTranscriptEvidenceService();
