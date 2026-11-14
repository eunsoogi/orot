import type { SqlDatabase } from '@orot/storage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';

/** Synthetic records in real SQLite. Cap populated pages to one item to isolate a two-page budget. */
export async function researchPagingWorkflowCatalog(
  database: SqlDatabase,
  populated: boolean,
) {
  const storage = createResearchArtifactStorage(database);
  if (populated)
    await storage.append(
      [1, 2].map(index => ({
        createdAt: '2026-10-05T00:00:00.000Z',
        originFeature: 'record_conversation',
        providerId: 'provider',
        modelId: 'model',
        source: {
          kind: 'public_web_search' as const,
          status: 'historical_snapshot' as const,
          retrievedAt: '2026-10-05T00:00:00.000Z',
          sources: [{ title: 'Synthetic source', url: 'https://example.org' }],
        },
        generatedText: `Synthetic saved research ${index}`,
      })),
      await storage.currentGeneration(),
    );
  const discovery = createResearchArtifactDiscovery(storage);
  let calls = 0;
  const search = jest.fn(
    async (request: Parameters<typeof discovery.search>[0]) => {
      if (populated) return discovery.search({ ...request, limit: 1 });
      return {
        items: [],
        unavailableCount: 0,
        nextCursor: ++calls === 1 ? 'research-9' : null,
      };
    },
  );
  return { ...discovery, search };
}
