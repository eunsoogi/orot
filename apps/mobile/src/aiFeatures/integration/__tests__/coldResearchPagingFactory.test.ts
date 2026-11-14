import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';

/** Actual SQLite and production factory; no model/provider or physical-device execution. */
test.each(['continue', 'deleted', 'foreign'] as const)(
  'cold research paging preserves exact original cursor (%s)',
  async mode => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const storage = createResearchArtifactStorage(db.database);
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
            sources: [
              { title: 'Synthetic source', url: 'https://example.org' },
            ],
          },
          generatedText: `Synthetic saved research ${index}`,
        })),
        await storage.currentGeneration(),
      );
      const discovery = createResearchArtifactDiscovery(storage);
      const search = jest.spyOn(discovery, 'search');
      const f = await coldRagFactoryFixture(undefined, data => {
        data.researchArtifactDiscovery = async () => discovery;
      });
      const request = {
        operationRunId: 'run',
        operationKey: 'initial',
        input: { query: 'Synthetic' },
        allowedScope: { sourceKinds: ['generated_artifact' as const] },
        resultLimit: 1,
        maxPayloadBytes: 20000,
        signal: f.controller.signal,
      };
      const first = await f.options.tools
        .find(tool => tool.id === 'local-research-artifacts')!
        .search(request);
      if ('status' in first) throw new Error('Unexpected consent');
      const cursor = first.coverage[0]!.nextCursor;
      if (!cursor) throw new Error('Missing research page');
      expect(f.registry.resolve(first.items[0]!)?.sourceId).toBe('research-2');
      f.descriptor.reconstruction = await captureColdRagConversationState({
        registry: f.registry,
        tracker: f.tracker,
        external: f.external,
        sessionId: 'session',
        operationRunId: 'run',
        knownCallIds: [],
        batches: [f.options.initialEvidence],
        options: f.options,
        signal: f.controller.signal,
        researchPaging: f.bundle.generated.researchPagingSnapshot!('run'),
      });
      if (mode === 'deleted')
        await db.database.execute(
          'DELETE FROM research_artifacts WHERE id = ?',
          [2],
        );
      if (mode === 'foreign') {
        const paging = f.descriptor.reconstruction.researchPaging as {
          tokens: Array<{ scope: string }>;
        };
        paging.tokens[0]!.scope = 'another-run';
      }
      const restore = () =>
        restoreColdRagConversationFactory({
          descriptor: f.descriptor,
          dependencies: f.dependencies,
          signal: f.controller.signal,
          readKnownCallIds: async () => [],
        });
      if (mode !== 'continue') {
        await expect(restore()).rejects.toThrow();
        expect(search).toHaveBeenCalledTimes(1);
        return;
      }
      const restored = await restore();
      expect(search).toHaveBeenCalledTimes(1);
      const next = await restored.options.tools
        .find(tool => tool.id === 'local-research-artifacts')!
        .search({
          ...request,
          operationKey: 'next',
          input: { query: 'Synthetic', cursor },
        });
      if ('status' in next) throw new Error('Unexpected consent');
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1]![0].cursor).toBe('research-2');
      expect(restored.registry.resolve(next.items[0]!)?.sourceId).toBe(
        'research-1',
      );
      expect(restored.bundle.generated.hasUnsupportedPagingState()).toBe(false);
      const recaptured = await restored.capture([f.options.initialEvidence]);
      expect(recaptured.researchPaging).toEqual(
        f.descriptor.reconstruction.researchPaging,
      );
      expect(f.search).not.toHaveBeenCalled();
      expect(f.authorize).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  },
);
