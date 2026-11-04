import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { providerSuccess } from '@orot/model-runtime';
import type { EvidenceSearchTool } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildManualHistoryEvidence } from '../manualHistoryEvidence';
import { createResearchInputTracker } from '../researchInputTracker';
import { retainPublicWebResults } from '../researchRetention';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createResearchArtifactTool } from '../researchArtifactTool';
import { captureConversationSources } from '../captureConversationSources';
import { localData } from '../featureServiceFixtures';
import {
  publicEvidenceFixture,
  publicResponse,
} from '../testSupport/publicWebEvidenceTestSupport';

test.each(['delete', 'correct'] as const)(
  'free-form research and dependent output follow source %s',
  async action => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const history = createManualHistoryRepository(db.database);
      const entry = await history.create({
        kind: 'note',
        title: 'Synthetic',
        details: 'Private synthetic detail',
        effectiveDate: { status: 'unknown' },
      });
      const evidence = await history.getEvidence(entry.id);
      if (!evidence) throw new Error('Missing fixture evidence');
      const registry = new LocalEvidenceReferenceRegistry();
      const item = buildManualHistoryEvidence({
        candidates: [evidence],
        repository: history,
        registry,
      }).items[0]!;
      const local: EvidenceSearchTool = {
        id: 'local-fixture',
        sourceKind: 'personal_record',
        execution: 'local_read_only',
        description: 'fixture',
        inputSchema: {},
        parseInput: () => ({}),
        search: async () => ({ items: [item], coverage: [], conflicts: [] }),
      };
      const tracker = createResearchInputTracker(registry);
      const run = publicEvidenceFixture();
      run.search.mockResolvedValue(
        providerSuccess({
          ...publicResponse,
          text: 'Private synthetic detail echoed in generated explanation.',
        }),
      );
      await tracker.wrap([local])[0]!.search({
        ...run.request,
        allowedScope: { sourceKinds: ['personal_record'] },
      });
      const storage = createResearchArtifactStorage(db.database);
      const data = Object.assign(localData([]).data, {
        openResearchArtifactStorage: async () => storage,
        researchArtifactDiscovery: async () =>
          createResearchArtifactDiscovery(
            createResearchArtifactStorage(db.database),
          ),
        manualHistory: history,
      });
      const web = createPublicWebEvidence(run)!;
      const result = await retainPublicWebResults(
        web.tool,
        async () => data,
        'provider',
        'model',
        'symptom_summary',
        undefined,
        tracker.capture,
      ).search(run.request);
      if ('status' in result) throw new Error('Unexpected consent');
      expect(result.coverage[0]?.gaps).toEqual([]);
      expect(
        (await storage.search('private synthetic detail', null, 10)).items,
      ).toHaveLength(1);
      const signal = new AbortController().signal;
      const found = await createResearchArtifactTool(data, registry).search({
        operationRunId: 'later',
        operationKey: 'search',
        input: { query: 'private synthetic detail' },
        allowedScope: { sourceKinds: ['generated_artifact'] },
        resultLimit: 2,
        maxPayloadBytes: 10000,
        signal,
      });
      if ('status' in found) throw new Error('Unexpected consent');
      const detail = await registry.readSource(found.items[0]!, signal);
      if (
        detail.status !== 'available' ||
        detail.document.sourceKind !== 'generated_artifact' ||
        !('research' in detail.document)
      )
        throw new Error('Missing research detail');
      expect(detail.document.sources).toHaveLength(2);
      expect(
        (await registry.readSource(detail.document.sources[1]!, signal)).status,
      ).toBe('available');
      const captured = await captureConversationSources(
        found.items,
        registry,
        signal,
      );
      const citation = captured.mapping.get(JSON.stringify(found.items[0]))!;
      const conversations = createConversationArtifactStorage(db.database);
      await conversations.createSession(
        'later-session',
        await conversations.currentGeneration(),
      );
      await conversations.append({
        id: 'dependent',
        sessionId: 'later-session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'question',
        answer: 'answer',
        sources: captured.sources,
        citations: [citation],
      });
      expect(await conversations.read('dependent')).not.toBeNull();
      await db.database.execute('DELETE FROM research_artifact_sources');
      await storage.rebuildSearchIndex();
      if (action === 'delete') await history.delete(entry.id);
      else
        await history.correct(entry.id, {
          kind: 'note',
          title: 'Corrected',
          details: 'Revised synthetic detail',
          effectiveDate: { status: 'unknown' },
        });
      expect(
        (await storage.search('private synthetic detail', null, 10)).items,
      ).toHaveLength(0);
      expect(
        (
          await db.database.execute(
            'SELECT id FROM conversation_artifacts WHERE id = ?',
            ['dependent'],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await db.database.execute(
            'SELECT snapshot_json FROM research_artifacts',
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      db.close();
    }
  },
);
