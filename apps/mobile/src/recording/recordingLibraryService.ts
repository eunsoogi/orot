import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import type { SourceMemoryDeletionResult } from '../memory/removeSourceWithMemory';
import type { RecordingDeletionTimingProbe } from './recordingDeletionTiming';
import type {
  RecordingAudioDeletion,
  RecordingLibraryService,
} from './recordingLibraryServiceTypes';
import { performRecordingDeletion } from './recordingDeletionOperation';
import {
  readRecordingSummarySnapshot,
  recordingLibrarySummaries,
} from './recordingLibrarySummaries';
import {
  beginRecordingDeletionTiming,
  endRecordingDeletionTiming,
} from './recordingDeletionTiming';

export type {
  RecordingAudioDeletion,
  RecordingDeletionResult,
  RecordingLibraryService,
  RecordingLibrarySummary,
  RecordingTranscriptReviewState,
} from './recordingLibraryServiceTypes';

type RepositoryLoader = () => Promise<RecordRepository>;
type MemoryLoader = () => Promise<AgentMemoryService>;
type SourceRemover = (
  sourceId: string,
  memory: AgentMemoryService,
  timingProbe?: RecordingDeletionTimingProbe,
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
  // Opening memory only needs the provider. Source removal prepares RAG tables before its transaction.
  return memoryModule.openOrReuseLocalAgentMemory(rag.provider);
}

async function assertRecordingStopped(): Promise<void> {
  const { recordingService } = await import('./recordingService');
  const state = await recordingService.getState();
  if (state.status !== 'idle' && state.status !== 'completed') {
    throw new Error('A recording must be stopped before it can be deleted.');
  }
}

/** Default native adapter; the Simulator fixture wraps it to exercise cleanup timing and recovery. */
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
  timingProbe?: RecordingDeletionTimingProbe,
): Promise<SourceMemoryDeletionResult> {
  const { removeLocalSourceWithMemory } =
    await import('../memory/removeSourceWithMemory');
  return removeLocalSourceWithMemory(sourceId, memory, timingProbe);
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
  const deletionDependencies = {
    loadRepository,
    openMemory,
    removeSource,
    audioDeletion,
    ensureStopped,
  };

  async function loadRecordings(loadedRepository?: RecordRepository) {
    const repository = loadedRepository ?? (await loadRepository());
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
    async listSummaries() {
      const repository = await loadRepository();
      const snapshot = await readRecordingSummarySnapshot(repository);
      return serializeAudioOperation(async () => {
        // Fresh source identities and crash recovery stay mutually exclusive with live audio deletion.
        const { recordings } = await loadRecordings(repository);
        return recordingLibrarySummaries(recordings, snapshot);
      });
    },
    deleteRecording(sourceId, timingProbe) {
      // Confirmation can arrive during a library read; measure that wait before source I/O starts.
      // Queue acquisition succeeds even when the preceding read failed; recovery exclusion is unchanged.
      beginRecordingDeletionTiming(timingProbe, 'library-queue-wait');
      return serializeAudioOperation(() => {
        endRecordingDeletionTiming(
          timingProbe,
          'library-queue-wait',
          'success',
        );
        return performRecordingDeletion(
          sourceId,
          timingProbe,
          deletionDependencies,
        );
      });
    },
  };
}

export const recordingLibraryService = createRecordingLibraryService();
