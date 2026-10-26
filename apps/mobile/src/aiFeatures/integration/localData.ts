import { createLocalE5RagService } from '../../rag/localE5RagService';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { LocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { LocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import type { PersistedMemoryRecord } from '@orot/agent-memory';

export type { StaleEvidenceArtifact } from './transcriptInvalidations';

export interface AiFeatureLocalData extends LocalEvidenceData {
  readonly repository: LocalHealthEvidenceRepository;
  readonly rag: Pick<LocalE5RagService, 'index' | 'search'>;
  readonly memoryStorage: Pick<SqlCipherAgentMemoryStorage, 'listRecords'>;
  loadMemoryRecords(): Promise<readonly PersistedMemoryRecord[]>;
}

let opening: Promise<AiFeatureLocalData> | null = null;

/** Shares one SQLCipher-backed local data surface across record, transcript, and reviewed-memory reads. */
export function openAiFeatureLocalData(): Promise<AiFeatureLocalData> {
  if (!opening) {
    opening = openDefault().catch(error => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

async function openDefault(): Promise<AiFeatureLocalData> {
  const database = await openLocalAgentMemoryDatabase();
  const repository = createLocalHealthEvidenceRepository(database);
  const rag = createLocalE5RagService(database);
  const memoryStorage = new SqlCipherAgentMemoryStorage(database);
  return {
    repository,
    rag,
    memoryStorage,
    ...createLocalEvidenceData(database),
    loadMemoryRecords: () => memoryStorage.listRecords(),
  };
}
