import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { fingerprint } from '../evidenceUtils';

test.each([0, 1])(
  'research input ancestry deletes descendants with recursive triggers %i',
  async recursive => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      await db.database.execute(`PRAGMA recursive_triggers = ${recursive}`);
      const storage = createResearchArtifactStorage(db.database);
      const generation = await storage.currentGeneration();
      const item = {
        createdAt: '2026-10-05T00:00:00.000Z',
        originFeature: 'symptom_summary',
        providerId: 'provider',
        modelId: 'model',
        source: {
          kind: 'public_web_search' as const,
          status: 'historical_snapshot' as const,
          retrievedAt: '2026-10-05T00:00:00.000Z',
          sources: [{ title: 'Synthetic source', url: 'https://example.org' }],
        },
        generatedText: 'Synthetic explanation',
      };
      await storage.append([item], generation);
      const firstRevision = fingerprint(await storage.read(1));
      const firstRef = {
        sourceKind: 'generated_artifact' as const,
        sourceId: 'research-1',
        sourceRevision: firstRevision,
        evidenceId: 'research-1',
        evidenceRevision: firstRevision,
        locator: {
          kind: 'generated_artifact',
          type: 'research_web_explanation',
        },
        effectiveTime: null,
        reviewState: 'unknown' as const,
      };
      await storage.append(
        [
          {
            ...item,
            inputSources: [
              {
                kind: 'generated_research',
                id: 'research-1',
                revision: firstRevision,
                reference: firstRef,
              },
            ],
          },
        ],
        generation,
      );
      const secondRevision = fingerprint(await storage.read(2));
      const secondRef = {
        ...firstRef,
        sourceId: 'research-2',
        evidenceId: 'research-2',
        sourceRevision: secondRevision,
        evidenceRevision: secondRevision,
      };
      const conversations = createConversationArtifactStorage(db.database);
      await conversations.createSession(
        'session',
        await conversations.currentGeneration(),
      );
      await conversations.append({
        id: 'descendant',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'question',
        answer: 'answer',
        sources: [
          {
            kind: 'generated_research',
            id: 'research-2',
            revision: secondRevision,
            reference: secondRef,
          },
        ],
        citations: [secondRef],
      });
      await db.database.execute(
        'DELETE FROM research_artifacts WHERE id = ?',
        [1],
      );
      expect(
        (await db.database.execute('SELECT id FROM research_artifacts')).rows,
      ).toHaveLength(0);
      expect(
        (await db.database.execute('SELECT id FROM conversation_artifacts'))
          .rows,
      ).toHaveLength(0);
    } finally {
      db.close();
    }
  },
);
