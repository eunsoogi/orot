import { createAgentMemory } from '@orot/agent-memory';
import type { AgentMemoryInput } from '@orot/agent-memory';
import { openEncryptedStorage } from '@orot/storage';
import {
  audioSourceRecord,
  createDatabase,
  options,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { transcriptSegment } from '../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import { createLocalE5RagService } from '../rag/localE5RagService';
import { removeLocalSourceWithMemory } from './removeSourceWithMemory';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

const embedder = {
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(text => {
      const vector = new Float32Array(16);
      for (const character of text)
        vector[character.charCodeAt(0) % vector.length] += 1;
      return vector;
    });
  },
};

describe('transcript-only question source deletion', () => {
  it('removes a question and its memory while retaining unrelated records', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(options(database));
    const source = await repository.sourceRecords.create(
      audioSourceRecord('recording-root'),
    );
    const revision = transcriptSegment(source.id);
    await repository.transcripts.append([revision]);
    const question = {
      id: 'question-from-transcript-only',
      effectiveAt: revision.effectiveAt,
      recordedAt: revision.recordedAt,
      ingestedAt: revision.ingestedAt,
      provenance: {
        origin: 'derived' as const,
        sourceRecordIds: [revision.id],
      },
      reviewState: { status: 'unreviewed' as const },
      questionText: 'Synthetic transcript question?',
      priority: 'routine' as const,
      evidenceSpanIds: [],
    };
    await repository.put('visit_question', question);
    const unrelated = {
      id: 'unrelated-manual-encounter',
      effectiveAt: '2026-10-05T11:00:00.000Z',
      recordedAt: '2026-10-05T11:00:00.000Z',
      ingestedAt: '2026-10-05T11:00:00.000Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      encounterKind: 'outpatient' as const,
      summary: 'Synthetic unrelated visit.',
    };
    await repository.put('encounter', unrelated);

    const memoryStorage = new SqlCipherAgentMemoryStorage(database);
    const memory = await createAgentMemory({
      embedder,
      storage: memoryStorage,
    });
    const linkedMemory: AgentMemoryInput = {
      memoryKey: 'question:transcript-only',
      text: 'A synthetic question refers to a transcript revision.',
      kind: 'task_context',
      provenance: {
        sourceIds: [question.id],
        reviewState: 'human_reviewed',
      },
    };
    const unrelatedMemory: AgentMemoryInput = {
      memoryKey: 'encounter:unrelated',
      text: 'A synthetic unrelated encounter remains available.',
      kind: 'task_context',
      provenance: {
        sourceIds: [unrelated.id],
        reviewState: 'human_reviewed',
      },
    };
    const linkedMemoryId = await memory.remember(linkedMemory);
    const unrelatedMemoryId = await memory.remember(unrelatedMemory);
    jest.mocked(openLocalStorage).mockResolvedValue(repository);
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
    jest.mocked(createLocalE5RagService).mockReturnValue({
      prepare: jest.fn().mockResolvedValue(undefined),
      deleteChunks: jest.fn().mockResolvedValue(undefined),
    } as never);

    try {
      const deletionReferences = await repository.listSourceDeletionReferences(
        source.id,
      );
      const result = await removeLocalSourceWithMemory(source.id, memory);

      expect(deletionReferences).toContain(question.id);
      expect(result).toEqual({
        sourceDeleted: true,
        memoriesDeleted: 1,
      });
      await expect(
        repository.get('visit_question', question.id),
      ).resolves.toBeNull();
      await expect(
        repository.get('encounter', unrelated.id),
      ).resolves.not.toBeNull();
      await expect(memoryStorage.listRecords()).resolves.toEqual([
        expect.objectContaining({ id: unrelatedMemoryId }),
      ]);
      expect(await memoryStorage.listRemovedSourceIds()).toEqual(
        expect.arrayContaining([question.id, linkedMemoryId]),
      );
    } finally {
      await memory.close();
      await database.closeAsync?.();
    }
  });
});
