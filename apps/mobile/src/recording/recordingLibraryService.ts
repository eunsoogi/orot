import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import type { RecordingSourceRecord } from './recordingTypes';
import type { SourceMemoryDeletionResult } from '../memory/removeSourceWithMemory';
import type { TranscriptEvidenceSegment } from '@orot/domain';

export type RecordingTranscriptReviewState =
  'notTranscribed' | 'unreviewed' | 'needsReview' | 'reviewed' | 'unavailable';

export interface RecordingLibrarySummary {
  readonly source: RecordingSourceRecord;
  readonly durationMs: number | null;
  readonly transcriptReviewState: RecordingTranscriptReviewState;
}

export interface RecordingLibraryService {
  list(): Promise<readonly RecordingSourceRecord[]>;
  readonly listSummaries?: () => Promise<readonly RecordingLibrarySummary[]>;
  deleteRecording(sourceId: string): Promise<RecordingDeletionResult>;
}

export interface RecordingDeletionResult {
  readonly audioCleanupPending: boolean;
}

export interface RecordingAudioDeletion {
  reconcile(sourceIds: readonly string[]): Promise<void>;
  stage(sourceId: string): Promise<void>;
  restore(sourceId: string): Promise<void>;
  commit(sourceId: string): Promise<void>;
}

type RepositoryLoader = () => Promise<RecordRepository>;
type MemoryLoader = () => Promise<AgentMemoryService>;
type SourceRemover = (
  sourceId: string,
  memory: AgentMemoryService,
) => Promise<SourceMemoryDeletionResult>;
type RecordingStateGuard = () => Promise<void>;

interface RecordingLibraryDependencies {
  readonly loadRepository?: RepositoryLoader;
  readonly openMemory?: MemoryLoader;
  readonly removeSource?: SourceRemover;
  readonly audioDeletion?: RecordingAudioDeletion;
  readonly assertRecordingStopped?: RecordingStateGuard;
}

async function loadLocalRepository(): Promise<RecordRepository> {
  // Keep SQLCipher's native adapter out of component tests and load it only when the saved-recording screen opens.
  const { openLocalStorage } = await import('../storage/secureDatabase');
  return openLocalStorage();
}

async function openDeletionMemory(): Promise<AgentMemoryService> {
  const [databaseModule, ragModule, memoryModule] = await Promise.all([
    import('../storage/secureDatabase'),
    import('../rag/localE5RagService'),
    import('../memory/localAgentMemory'),
  ]);
  const rag = ragModule.createLocalE5RagService(
    await databaseModule.openLocalAgentMemoryDatabase(),
  );
  await rag.prepare();
  return memoryModule.openOrReuseLocalAgentMemory(rag.provider);
}

async function assertRecordingStopped(): Promise<void> {
  const { recordingService } = await import('./recordingService');
  const state = await recordingService.getState();
  if (state.status !== 'idle' && state.status !== 'completed') {
    throw new Error('A recording must be stopped before it can be deleted.');
  }
}

export const nativeAudioDeletion: RecordingAudioDeletion = {
  async reconcile(sourceIds) {
    const { reconcileRecordingDeletions } =
      await import('./nativeRecordingBridge');
    return reconcileRecordingDeletions(sourceIds);
  },
  async stage(sourceId) {
    const { stageRecordingDeletion } = await import('./nativeRecordingBridge');
    return stageRecordingDeletion(sourceId);
  },
  async restore(sourceId) {
    const { restoreRecordingDeletion } =
      await import('./nativeRecordingBridge');
    return restoreRecordingDeletion(sourceId);
  },
  async commit(sourceId) {
    const { commitRecordingDeletion } = await import('./nativeRecordingBridge');
    return commitRecordingDeletion(sourceId);
  },
};

async function removeLocalSource(
  sourceId: string,
  memory: AgentMemoryService,
): Promise<SourceMemoryDeletionResult> {
  const { removeLocalSourceWithMemory } =
    await import('../memory/removeSourceWithMemory');
  return removeLocalSourceWithMemory(sourceId, memory);
}

/** Lists saved audio sources and coordinates reversible file staging with the existing dependent-data cascade. */
export function createRecordingLibraryService(
  dependencies: RecordingLibraryDependencies = {},
): RecordingLibraryService {
  const loadRepository = dependencies.loadRepository ?? loadLocalRepository;
  const openMemory = dependencies.openMemory ?? openDeletionMemory;
  const removeSource = dependencies.removeSource ?? removeLocalSource;
  const audioDeletion = dependencies.audioDeletion ?? nativeAudioDeletion;
  const ensureStopped =
    dependencies.assertRecordingStopped ?? assertRecordingStopped;

  async function loadRecordings() {
    const repository = await loadRepository();
    const sources = await repository.list('source_record');
    const recordings = sources
      .filter(source => source.sourceKind === 'audio_recording')
      .sort(
        (left, right) =>
          Date.parse(right.recordedAt) - Date.parse(left.recordedAt),
      );
    await audioDeletion.reconcile(recordings.map(source => source.id));
    return { repository, recordings };
  }

  let audioOperationTail: Promise<void> = Promise.resolve();
  function serializeAudioOperation<T>(operation: () => Promise<T>): Promise<T> {
    // Listing can restore staged audio as crash recovery, so it must wait for a live delete cascade.
    const result = audioOperationTail.then(operation, operation);
    audioOperationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    list() {
      return serializeAudioOperation(async () => {
        const { recordings } = await loadRecordings();
        return recordings;
      });
    },
    // One transcript-table read supplies latest revisions for every row without loading segment text into the UI.
    listSummaries() {
      return serializeAudioOperation(async () => {
        const { repository, recordings } = await loadRecordings();
        let transcriptSegments: readonly TranscriptEvidenceSegment[] | null;
        try {
          transcriptSegments = await repository.list('transcript_segment');
        } catch {
          // Keep audio visible if transcript metadata cannot be read; do not claim no transcript exists.
          transcriptSegments = null;
        }

        const latestByTranscript = new Map<string, TranscriptEvidenceSegment>();
        for (const segment of transcriptSegments ?? []) {
          const latest = latestByTranscript.get(segment.transcriptId);
          if (!latest || segment.revision > latest.revision) {
            latestByTranscript.set(segment.transcriptId, segment);
          }
        }
        const segmentsBySource = new Map<string, TranscriptEvidenceSegment[]>();
        for (const segment of latestByTranscript.values()) {
          const current = segmentsBySource.get(segment.recordingSourceId) ?? [];
          current.push(segment);
          segmentsBySource.set(segment.recordingSourceId, current);
        }

        return recordings.map(source => {
          const segments = segmentsBySource.get(source.id) ?? [];
          const durations = [
            ...new Set(segments.map(segment => segment.recordingDurationMs)),
          ];
          const transcriptDuration =
            durations.length === 1 ? durations[0] : null;
          let transcriptReviewState: RecordingTranscriptReviewState;
          if (transcriptSegments === null) {
            transcriptReviewState = 'unavailable';
          } else if (segments.length === 0) {
            transcriptReviewState = 'notTranscribed';
          } else if (
            segments.some(
              segment => segment.reviewState.status === 'needs_review',
            )
          ) {
            transcriptReviewState = 'needsReview';
          } else if (
            segments.some(
              segment => segment.reviewState.status === 'unreviewed',
            )
          ) {
            transcriptReviewState = 'unreviewed';
          } else {
            transcriptReviewState = 'reviewed';
          }
          return {
            source,
            durationMs: source.recordingDurationMs ?? transcriptDuration,
            transcriptReviewState,
          };
        });
      });
    },
    deleteRecording(sourceId) {
      return serializeAudioOperation(async () => {
        const repository = await loadRepository();
        const source = await repository.get('source_record', sourceId);
        if (!source || source.sourceKind !== 'audio_recording') {
          throw new Error('The selected recording is no longer available.');
        }
        await ensureStopped();
        await audioDeletion.stage(sourceId);

        let sourceRemoved = false;
        try {
          const memory = await openMemory();
          const result = await removeSource(sourceId, memory);
          if (!result.sourceDeleted) {
            sourceRemoved =
              (await repository.get('source_record', sourceId)) === null;
            if (!sourceRemoved) {
              throw new Error('The recording source could not be removed.');
            }
          } else {
            sourceRemoved = true;
          }
        } catch (error) {
          // Restore audio unless the source cascade positively confirmed deletion.
          if (!sourceRemoved) await audioDeletion.restore(sourceId);
          throw error;
        }

        try {
          await audioDeletion.commit(sourceId);
          return { audioCleanupPending: false };
        } catch {
          // Keep staged audio hidden; the next list/relaunch reconciles it against the committed source rows.
          return { audioCleanupPending: true };
        }
      });
    },
  };
}

export const recordingLibraryService = createRecordingLibraryService();
