import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import {
  getProtectedMedicalDocumentSourceIds,
  medicalDocumentFileDeletion,
  type MedicalDocumentFileDeletion,
} from '../medicalDocuments/medicalDocumentNativeBridge';
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
  readonly medicalDocumentCleanupPending: boolean;
};

export interface AllLocalDataDeletionDependencies {
  /** Allows tests to exercise staged-file recovery without a native recording module. */
  readonly audioDeletion?: Pick<
    RecordingAudioDeletion,
    'reconcile' | 'stage' | 'restore' | 'commit'
  >;
  /** Allows tests to verify protected-original recovery around the record transaction. */
  readonly medicalDocumentDeletion?: MedicalDocumentFileDeletion;
}

/** Clears local data while reversible media staging preserves originals on failure. */
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
  const documentDeletion =
    dependencies.medicalDocumentDeletion ?? medicalDocumentFileDeletion;
  const sources = await repository.list('source_record');
  const recordingSourceIds = sources
    .filter(source => source.sourceKind === 'audio_recording')
    .map(source => source.id);
  const documentSourceIds = sources
    .filter(source => source.sourceKind === 'medical_document')
    .map(source => source.id);
  const stagedRecordingIds: string[] = [];
  const stagedDocumentIds: string[] = [];
  let documentFileSourceIds = documentSourceIds;

  try {
    await audioDeletion.reconcile(recordingSourceIds);
    // Only saved rows clear bridge tracking; active picks are added after reconcile for deletion staging.
    await documentDeletion.reconcile(documentSourceIds);
    documentFileSourceIds = [
      ...new Set([
        ...documentSourceIds,
        ...(await getProtectedMedicalDocumentSourceIds()),
      ]),
    ];
    for (const sourceId of recordingSourceIds) {
      await audioDeletion.stage(sourceId);
      stagedRecordingIds.push(sourceId);
    }
    for (const sourceId of documentFileSourceIds) {
      await documentDeletion.stage(sourceId);
      stagedDocumentIds.push(sourceId);
    }

    // Fence every saved record before Rememori clears its rows, including manual records without sources.
    const localRecordIds = await repository.listAllLocalDeletionReferences();
    const memoriesDeleted = await memory.forgetAll(localRecordIds);
    const deleted = await repository.deleteAllLocalData(
      (transaction, _deletedSourceIds, deletedLocalRecordIds) =>
        rag.clear(deletedLocalRecordIds, transaction),
    );

    let audioCleanupPending = false;
    for (const sourceId of stagedRecordingIds) {
      try {
        await audioDeletion.commit(sourceId);
      } catch {
        // Keep staged files hidden; recording-list reconciliation retries their cleanup after deletion.
        audioCleanupPending = true;
      }
    }
    let medicalDocumentCleanupPending = false;
    for (const sourceId of stagedDocumentIds) {
      try {
        await documentDeletion.commit(sourceId);
      } catch {
        // Hidden staged originals remain excluded from backup and reconcile on the next import.
        medicalDocumentCleanupPending = true;
      }
    }
    return {
      ...deleted,
      memoriesDeleted,
      audioCleanupPending,
      medicalDocumentCleanupPending,
    };
  } catch (error) {
    const restoreFailures: unknown[] = [];
    for (const sourceId of [...stagedDocumentIds].reverse()) {
      try {
        await documentDeletion.restore(sourceId);
      } catch (restoreError) {
        restoreFailures.push(restoreError);
      }
    }
    for (const sourceId of [...stagedRecordingIds].reverse()) {
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
        `All-local deletion failed and local-file recovery was incomplete: ${messages.join('; ')}`,
      );
    }
    throw error;
  }
}
