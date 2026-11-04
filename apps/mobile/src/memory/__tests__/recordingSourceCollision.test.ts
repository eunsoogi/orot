import { createAgentMemory } from '@orot/agent-memory';
import { audioSource } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import { removeLocalSourceWithMemory } from '../removeSourceWithMemory';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
jest.mock('../../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

test.each(['untyped', 'health_observation'] as const)(
  'recording deletion preserves unrelated observation until its %s fence arrives',
  async nextFence => {
    const f = await healthContextFixture();
    const storage = new SqlCipherAgentMemoryStorage(f.database);
    const memory = await createAgentMemory({
      storage,
      embedder: { embed: async texts => texts.map(() => new Float32Array(16)) },
    });
    try {
      await f.repository.put('source_record', audioSource(f.inside.id));
      const store = createConversationArtifactStorage(f.database);
      await store.createSession('collision', await store.currentGeneration());
      await store.append({
        id: 'collision-turn',
        sessionId: 'collision',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'question',
        answer: 'answer',
        sources: f.saved.sources,
      });
      jest.mocked(openLocalStorage).mockResolvedValue(f.repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
      jest.mocked(createLocalE5RagService).mockReturnValue({
        prepare: jest.fn().mockResolvedValue(undefined),
        deleteChunks: jest.fn().mockResolvedValue(undefined),
      } as never);
      const deleteSource = f.repository.sourceRecords.delete.bind(
        f.repository.sourceRecords,
      );
      let beforeSourceDeletion: unknown;
      jest
        .spyOn(f.repository.sourceRecords, 'delete')
        .mockImplementation(async (...args) => {
          beforeSourceDeletion = await store.read('collision-turn');
          return deleteSource(...args);
        });
      await removeLocalSourceWithMemory(f.inside.id, memory);
      expect(
        await f.repository.get('health_observation', f.inside.id),
      ).not.toBeNull();
      expect(beforeSourceDeletion).not.toBeNull();
      expect(await store.read('collision-turn')).not.toBeNull();
      if (nextFence === 'untyped')
        await f.database.execute(
          'INSERT OR IGNORE INTO agent_memory_removed_sources (source_id) VALUES (?)',
          [f.inside.id],
        );
      else await storage.markSourceRemoved(f.inside.id, [nextFence]);
      expect(await store.read('collision-turn')).toBeNull();
    } finally {
      await memory.close();
      f.close();
    }
  },
);
