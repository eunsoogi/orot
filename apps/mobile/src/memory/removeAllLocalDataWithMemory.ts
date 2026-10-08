import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import {
  nativeAudioDeletion,
  type RecordingAudioDeletion,
} from '../recording/recordingLibraryService';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';

export type AllLocalDataDeletionResult = Awaited<
  ReturnType<RecordRepository['deleteAllLocalData']>
> & {
  readonly memoriesDeleted: number;
  readonly audioCleanupPending: boolean;
};

export interface AllLocalDataDeletionDependencies {
  /** Allows tests to exercise staged-file recovery without a native recording module. */
  readonly audioDeletion?: Pick<
    RecordingAudioDeletion,
    'reconcile' | 'stage' | 'restore' | 'commit'
  >;
}

/** Clears memory and records while reversible audio staging preserves files on failure. */
export async function removeAllLocalDataWithMemory(
  memory: AgentMemoryService,
  dependencies: AllLocalDataDeletionDependencies = {},
): Promise<AllLocalDataDeletionResult> {
  const [database, repository] = await Promise.all([
    openLocalAgentMemoryDatabase(),
    openLocalStorage(),
  ]);
  const rag = createLocalE5RagService(database);
  await rag.prepare();

  const audioDeletion = dependencies.audioDeletion ?? nativeAudioDeletion;
  const sources = await repository.list('source_record');
  const recordingSourceIds = sources
    .filter(source => source.sourceKind === 'audio_recording')
    .map(source => source.id);
  const stagedSourceIds: string[] = [];

  try {
    await audioDeletion.reconcile(recordingSourceIds);
    for (const sourceId of recordingSourceIds) {
      await audioDeletion.stage(sourceId);
      stagedSourceIds.push(sourceId);
    }

    // Fence every saved record before Rememori clears its rows, including manual records without sources.
    const localRecordIds = await repository.listAllLocalDeletionReferences();
    const memoriesDeleted = await memory.forgetAll(localRecordIds);
    const deleted = await repository.deleteAllLocalData(
      (transaction, _deletedSourceIds, deletedLocalRecordIds) =>
        rag.clear(deletedLocalRecordIds, transaction),
    );

    let audioCleanupPending = false;
    for (const sourceId of stagedSourceIds) {
      try {
        await audioDeletion.commit(sourceId);
      } catch {
        // Keep staged files hidden; recording-list reconciliation retries their cleanup after deletion.
        audioCleanupPending = true;
      }
    }
    return { ...deleted, memoriesDeleted, audioCleanupPending };
  } catch (error) {
    const restoreFailures: unknown[] = [];
    for (const sourceId of [...stagedSourceIds].reverse()) {
      try {
        await audioDeletion.restore(sourceId);
      } catch (restoreError) {
        restoreFailures.push(restoreError);
      }
    }
    if (restoreFailures.length > 0) {
      const messages = [error, ...restoreFailures].map(failure =>
        failure instanceof Error ? failure.message : String(failure),
      );
      throw new Error(
        `All-local deletion failed and audio recovery was incomplete: ${messages.join('; ')}`,
      );
    }
    throw error;
  }
}
