import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test.each([1, 2, 3, 'abort-final'])(
  'tool read boundary %s fences session removal or cancellation',
  async hideAt => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const storage = createConversationArtifactStorage(connection.database);
      await storage.createSession('session', await storage.currentGeneration());
      await storage.append({
        id: 'turn',
        sessionId: 'session',
        createdAt: '2026-11-06T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'question',
        answer: 'answer',
        sources: [],
        citations: [],
      });
      const data = localData([]).data;
      const registry = new LocalEvidenceReferenceRegistry();
      const discovery = createConversationArtifactDiscovery({
        database: connection.database,
        storage,
        data,
        registry,
      });
      let reads = 0;
      const controller = new AbortController();
      const options = createConversationSessionOptions({
        registry,
        loadLocalData: async () => ({
          ...data,
          conversationArtifactDiscovery: async () => discovery,
          openConversationArtifactStorage: async () => ({
            ...storage,
            async readToolTurnsSnapshot(id, version) {
              if (++reads === hideAt) await storage.hideSession(id, 0);
              const snapshot = await storage.readToolTurnsSnapshot(id, version);
              if (hideAt === 'abort-final' && reads === 3) controller.abort();
              return snapshot;
            },
          }),
        }),
      });
      await expect(
        options.restoreSession!('session', controller.signal),
      ).rejects.toThrow();
    } finally {
      connection.close();
    }
  },
);
