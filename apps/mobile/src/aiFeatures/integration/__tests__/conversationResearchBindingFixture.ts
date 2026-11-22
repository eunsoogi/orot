import type { SqlDatabase } from '@orot/storage';
import type { RagConversationObserver } from '../../../ragConversation/service';
import type { createResearchInputTracker } from '../researchInputTracker';
import { createSelectedExternalEvidence } from '../selectedExternalEvidence';
import { retainLiteratureResults } from '../researchRetention';
import type { AiFeatureLocalData } from '../localData';
import type { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

/** Exercise the real research adapters. Neither transport can make a live request. */
export function createResearchBindingTools(
  run: ReturnType<typeof publicEvidenceFixture>,
  loadData: () => Promise<AiFeatureLocalData>,
  onResearchRetained: ReturnType<
    typeof createResearchInputTracker
  >['recordResearch'],
  at: string,
) {
  const literatureSearch = jest.fn(async () => ({
    status: 'available' as const,
    publications: [
      {
        provider: 'Europe PMC' as const,
        source: 'MED',
        recordId: '123',
        title: 'Synthetic study',
        authors: null,
        journal: null,
        publicationDate: null,
        updatedDate: '2025-01-01',
        originalUrl: 'https://europepmc.org/article/MED/123',
        retrievedAt: at,
        abstract: 'Synthetic public abstract',
      },
    ],
  }));
  const selected = createSelectedExternalEvidence({
    ...run,
    loadData,
    originFeature: 'record_conversation',
    retentionSession: { id: 'synthetic-1', version: 0 },
    captureResearchInputs: async () => [],
    onResearchRetained: onResearchRetained,
    literature: retainLiteratureResults(
      { search: literatureSearch },
      loadData,
      'record_conversation',
      { id: 'synthetic-1', version: 0 },
      onResearchRetained,
    ),
    literatureConsent: { authorize: async () => 'authorized' },
  });
  return { selected, literatureSearch };
}

export const syntheticAnswer = 'Synthetic answer';

/** Feed the existing protected final-save callback, not only the visible outcome. */
export async function saveSyntheticAnswer(
  observer: RagConversationObserver,
  question: string,
  signal: AbortSignal | undefined,
) {
  if (!signal) throw new Error('The synthetic send requires its owned signal.');
  await observer.onRetentionCandidate!(
    {
      question,
      answer: syntheticAnswer,
      providerId: 'synthetic-provider',
      modelId: 'synthetic-model',
      sources: [],
      citations: [],
    },
    signal,
  );
}

export async function assertSavedAnswer(database: SqlDatabase) {
  const { rows } = await database.execute(
    'SELECT result_json FROM conversation_artifacts WHERE session_id = ?',
    ['synthetic-1'],
  );
  expect(rows).toHaveLength(1);
  expect(JSON.parse(String(rows[0]?.result_json)).answer).toBe(syntheticAnswer);
}
