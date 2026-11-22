import type { ConversationToolEvent } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import { bindLiveConversationToolSources } from '../../../aiFeatures/integration/bindLiveConversationToolSources';
import { captureConversationToolSources } from '../../../aiFeatures/integration/captureConversationToolSources';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../../aiFeatures/integration/featureServiceFixtures';
import { createResearchArtifactDiscovery } from '../../../aiFeatures/integration/researchArtifactDiscovery';
import { createResearchInputTracker } from '../../../aiFeatures/integration/researchInputTracker';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';

export const literatureOwner = {
  sessionId: 'synthetic-literature-session',
  messageId: 'synthetic-literature-turn',
  operationRunId: 'synthetic-literature-run',
  callId: 'synthetic-literature-call',
};
export const paperTitle = 'Synthetic stored literature';
const at = '2026-01-14T08:00:00.000Z';

/** Seed a completed public-only result, then bind its actual durable call and lineage.
 * This never executes a provider or literature search. */
export async function completedLiteratureSource(database: SqlDatabase) {
  const storage = createConversationArtifactStorage(database);
  const research = createResearchArtifactStorage(database);
  const session = { id: literatureOwner.sessionId, version: 0 };
  await storage.createSession(session.id, await storage.currentGeneration());
  const [id] = await research.append(
    [
      {
        createdAt: at,
        originFeature: 'record_conversation',
        originSession: session.id,
        providerId: 'synthetic-provider',
        modelId: 'synthetic-model',
        generatedText: null,
        inputSources: [],
        source: {
          kind: 'publication',
          status: 'historical_snapshot',
          retrievedAt: at,
          title: paperTitle,
          url: 'https://europepmc.org/article/MED/123',
        },
      },
    ],
    await research.currentGeneration(),
    undefined,
    session,
  );
  if (!id) throw new Error('Could not seed synthetic literature');
  const registry = new LocalEvidenceReferenceRegistry();
  const data = {
    ...localData([]).data,
    openResearchArtifactStorage: async () => research,
    researchArtifactDiscovery: async () =>
      createResearchArtifactDiscovery(research),
  };
  const external = {
    sourceKind: 'external_medical' as const,
    sourceId: 'europe-pmc',
    sourceRevision: `retrieved:${at}`,
    evidenceId: 'MED:123',
    evidenceRevision: `retrieved:${at}`,
  };
  await createResearchInputTracker(registry, data, session.id).recordResearch(
    [id],
    new AbortController().signal,
    [external],
    literatureOwner,
  );
  const event: ConversationToolEvent = {
    version: 1,
    operationRunId: literatureOwner.operationRunId,
    callId: literatureOwner.callId,
    toolName: 'europe-pmc-publication-search',
    order: 1,
    status: 'completed',
    inputSummary: { sourceKind: 'external_medical' },
    sources: [external],
  };
  const captured = await captureConversationToolSources(
    event,
    registry,
    storage,
    session.id,
  );
  expect(captured.dependencies).toHaveLength(1);
  await storage.appendToolEvent({
    ...literatureOwner,
    createdAt: at,
    sessionVersion: 0,
    ...captured,
  });
  await bindLiveConversationToolSources(
    captured.event,
    session.id,
    storage,
    data,
    registry,
  );
  return { event, registry, storage };
}
