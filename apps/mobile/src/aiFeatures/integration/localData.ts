import { createLocalE5RagService } from '../../rag/localE5RagService';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { LocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { LocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createSummaryArtifactDiscovery } from './summaryArtifactDiscovery';

export type { StaleEvidenceArtifact } from './transcriptInvalidations';

export interface AiFeatureLocalData extends LocalEvidenceData {
  readonly repository: LocalHealthEvidenceRepository;
  readonly rag: Pick<LocalE5RagService, 'index' | 'search'>;
  readonly memoryStorage: Pick<SqlCipherAgentMemoryStorage, 'listRecords'>;
  loadMemoryRecords(): Promise<readonly PersistedMemoryRecord[]>;
  summaryArtifactDiscovery?(
    registry: LocalEvidenceReferenceRegistry,
  ): Promise<ReturnType<typeof createSummaryArtifactDiscovery>>;
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
  const data: AiFeatureLocalData = {
    repository,
    rag,
    memoryStorage,
    ...createLocalEvidenceData(database),
    loadMemoryRecords: () => memoryStorage.listRecords(),
    async summaryArtifactDiscovery(registry) {
      const [
        { createSummaryArtifactDiscovery },
        { createSymptomSummaryStorage },
      ] = await Promise.all([
        import('./summaryArtifactDiscovery'),
        import('../../storage/symptomSummaryStorage'),
      ]);
      return createSummaryArtifactDiscovery({
        database,
        storage: createSymptomSummaryStorage(database),
        data,
        registry,
      });
    },
  };
  return data;
}
