import { createLocalE5RagService } from '../../rag/localE5RagService';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import type {
  LocalHealthEvidenceInventory,
  LocalHealthEvidenceRepository,
} from '../../healthEvidence/localEvidenceRepository';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { buildPersistedEvidenceChunks } from '@orot/rag';
import type { EvidenceChunk } from '@orot/rag';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { readCurrentTranscriptInvalidations } from './transcriptInvalidations';
import type { StaleEvidenceArtifact } from './transcriptInvalidations';

export type { StaleEvidenceArtifact } from './transcriptInvalidations';

export interface AiFeatureLocalData {
  readonly repository: LocalHealthEvidenceRepository;
  readonly rag: Pick<LocalE5RagService, 'index' | 'search'>;
  readonly memoryStorage: Pick<SqlCipherAgentMemoryStorage, 'listRecords'>;
  loadInventory(signal?: AbortSignal): Promise<LocalHealthEvidenceInventory>;
  loadPersistedChunks(): Promise<EvidenceChunk[]>;
  loadStaleArtifacts(): Promise<readonly StaleEvidenceArtifact[]>;
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
  const [database, records] = await Promise.all([
    openLocalAgentMemoryDatabase(),
    openLocalStorage(),
  ]);
  const repository = createLocalHealthEvidenceRepository(database);
  const rag = createLocalE5RagService(database);
  const memoryStorage = new SqlCipherAgentMemoryStorage(database);
  return {
    repository,
    rag,
    memoryStorage,
    loadInventory: signal => repository.readInventory({ signal }),
    loadPersistedChunks: () => buildPersistedEvidenceChunks(records),
    loadStaleArtifacts: () => readCurrentTranscriptInvalidations(records),
    loadMemoryRecords: () => memoryStorage.listRecords(),
  };
}
