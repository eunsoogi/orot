import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test.each([1, 2])(
  'a session hidden before tool read %i cannot restore transcript content',
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
      const options = createConversationSessionOptions({
        registry,
        loadLocalData: async () => ({
          ...data,
          conversationArtifactDiscovery: async () => discovery,
          openConversationArtifactStorage: async () => ({
            ...storage,
            async readToolTurns(id, version) {
              if (++reads === hideAt) await storage.hideSession(id, 0);
              return storage.readToolTurns(id, version);
            },
          }),
        }),
      });
      await expect(
        options.restoreSession!('session', new AbortController().signal),
      ).rejects.toThrow();
    } finally {
      connection.close();
    }
  },
);
