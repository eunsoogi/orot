import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { fingerprint } from '../evidenceUtils';
import { createConversationSessionStorage } from '../conversationSessionStorage';

export async function quarantinedHistoryFixture() {
  const f = await healthContextFixture();
  const summary = { ...f.saved, inputLineage: 'complete' as const };
  await f.storage.append(summary);
  const revision = fingerprint(summary);
  const reference = {
    sourceKind: 'generated_artifact' as const,
    sourceId: summary.id,
    evidenceId: summary.id,
    sourceRevision: revision,
    evidenceRevision: revision,
    locator: { kind: 'generated_artifact', type: 'symptom_summary' },
    effectiveTime: null,
    reviewState: 'unreviewed' as const,
  };
  const storage = createConversationArtifactStorage(f.database);
  await storage.createSession('session', await storage.currentGeneration());
  await storage.append({
    id: 'older',
    sessionId: 'session',
    createdAt: '2026-10-05T00:00:00.000Z',
    providerId: 'synthetic',
    modelId: 'synthetic',
    status: 'complete',
    question: 'Synthetic older question',
    answer: 'Synthetic older answer',
    citations: [reference],
    sources: [
      { kind: 'generated_summary', reference, id: summary.id, revision },
    ],
  });
  await storage.append({
    id: 'newer',
    sessionId: 'session',
    createdAt: '2026-10-06T00:00:00.000Z',
    providerId: 'synthetic',
    modelId: 'synthetic',
    status: 'complete',
    question: 'Synthetic safe question',
    answer: 'Synthetic safe answer',
    citations: [],
    sources: [],
  });
  const registry = new LocalEvidenceReferenceRegistry();
  const data = {
    ...localData([]).data,
    readHealthContext: f.read,
    openConversationArtifactStorage: async () => storage,
  };
  data.summaryArtifactDiscovery = async selectedRegistry =>
    createSummaryArtifactDiscovery({
      database: f.database,
      storage: f.storage,
      registry: selectedRegistry,
      data,
    });
  const discovery = createConversationArtifactDiscovery({
    database: f.database,
    storage,
    registry,
    data,
  });
  data.conversationArtifactDiscovery = async () => discovery;
  const input = { loadLocalData: async () => data, registry };
  const open = createConversationSessionStorage(input.loadLocalData);
  const quarantine = () =>
    f.database.execute(
      "UPDATE summary_period_policy SET status='quarantined' WHERE summary_id=?",
      [summary.id],
    );
  return { ...f, storage, discovery, input, open, quarantine };
}
