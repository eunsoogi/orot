import type { RecordRepository } from '@orot/storage';
import type { MedicalDocumentFileDeletion } from './medicalDocumentNativeBridge';
import { medicalDocumentFileDeletion } from './medicalDocumentNativeBridge';
import {
  startMedicalDocumentDeletion,
  endMedicalDocumentDeletion,
  retireDeletedMedicalDocumentSources,
} from './medicalDocumentLifecycle';

export interface MedicalDocumentDeletionResult {
  readonly cleanupPending: boolean;
}
interface Dependencies {
  repository: () => Promise<RecordRepository>;
  removeSource: (id: string) => Promise<{ sourceDeleted: boolean }>;
  files: MedicalDocumentFileDeletion;
}

/** Stage only the app-owned copy; the source cascade owns RAG, memories and derived records. */
export function createMedicalDocumentDeletion(dependencies: Dependencies) {
  return async (sourceId: string): Promise<MedicalDocumentDeletionResult> => {
    // Exclude concurrent import reconciliation and all-local deletion across service instances.
    startMedicalDocumentDeletion();
    try {
      const repository = await dependencies.repository();
      const source = await repository.sourceRecords.get(sourceId);
      if (!source || source.sourceKind !== 'medical_document') {
        throw new Error('The imported document is unavailable.');
      }
      await dependencies.files.stage(sourceId);
      try {
        await dependencies.removeSource(sourceId);
      } catch (error) {
        // A thrown write may already have committed. Never restore an original unless
        // a fresh database read confirms its source still exists; unknown stays hidden.
        if (await repository.sourceRecords.get(sourceId)) {
          await dependencies.files.restore(sourceId);
          throw error;
        }
      }
      if (await repository.sourceRecords.get(sourceId)) {
        await dependencies.files.restore(sourceId);
        throw new Error('The imported document could not be deleted.');
      }
      retireDeletedMedicalDocumentSources([sourceId]);
      try {
        await dependencies.files.commit(sourceId);
        return { cleanupPending: false };
      } catch {
        // Native staging survives restart; the next import reconciles hidden leftovers.
        return { cleanupPending: true };
      }
    } finally {
      endMedicalDocumentDeletion();
    }
  };
}

export const deleteMedicalDocument = createMedicalDocumentDeletion({
  repository: async () => {
    const { openLocalStorage } = await import('../storage/secureDatabase');
    return openLocalStorage();
  },
  files: medicalDocumentFileDeletion,
  removeSource: async id => {
    const [
      { openLocalAgentMemoryDatabase },
      { createLocalE5RagService },
      { openOrReuseLocalAgentMemory },
      { removeLocalSourceWithMemory },
    ] = await Promise.all([
      import('../storage/secureDatabase'),
      import('../rag/localE5RagService'),
      import('../memory/localAgentMemory'),
      import('../memory/removeSourceWithMemory'),
    ]);
    const rag = createLocalE5RagService(await openLocalAgentMemoryDatabase());
    const memory = await openOrReuseLocalAgentMemory(rag.provider);
    return removeLocalSourceWithMemory(id, memory);
  },
});
