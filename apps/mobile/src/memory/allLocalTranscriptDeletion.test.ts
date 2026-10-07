import { createAgentMemory } from '@orot/agent-memory';
import type { AgentMemoryService } from '@orot/agent-memory';
import { openEncryptedStorage } from '@orot/storage';
import {
  audioSourceRecord,
  createDatabase,
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { transcriptSegment } from '../../../../packages/storage/__tests__/localQueryTestSupport';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { createLocalE5RagService } from '../rag/localE5RagService';
import { removeAllLocalDataWithMemory } from './removeAllLocalDataWithMemory';

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

describe('all-local transcript deletion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fences a transcript bundle reference after the SQLite database is reopened', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-all-local-transcript-'));
    const databasePath = join(directory, 'local.sqlite');
    let database = createDatabase(databasePath);
    let memory: AgentMemoryService | null = null;

    try {
      const repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('all-local-transcript-recording'),
      );
      const segment = transcriptSegment(source.id);
      await repository.transcripts.append([segment]);
      memory = await createAgentMemory({
        embedder,
        storage: new SqlCipherAgentMemoryStorage(database),
      });
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
      const clear = jest.fn().mockResolvedValue(undefined);
      jest.mocked(createLocalE5RagService).mockReturnValue({
        prepare: jest.fn().mockResolvedValue(undefined),
        clear,
      } as never);

      await removeAllLocalDataWithMemory(memory);
      await expect(
        repository.get('source_record', source.id),
      ).resolves.toBeNull();
      await expect(
        repository.get('transcript_segment', segment.id),
      ).resolves.toBeNull();
      await memory.close();
      memory = null;
      await database.closeAsync?.();

      database = createDatabase(databasePath);
      const reopened = await createAgentMemory({
        embedder,
        storage: new SqlCipherAgentMemoryStorage(database),
      });
      memory = reopened;
      // A resumed workflow may write this stable transcript identity without an existing memory row.
      await expect(
        reopened.remember({
          memoryKey: 'stale-transcript-reference',
          text: 'Synthetic stale transcript memory.',
          kind: 'task_context',
          provenance: {
            sourceIds: [segment.transcriptId],
            reviewState: 'human_reviewed',
          },
        }),
      ).rejects.toThrow('already removed');
      expect(clear).toHaveBeenCalledWith(
        expect.arrayContaining([segment.transcriptId]),
        expect.anything(),
      );
    } finally {
      if (memory) await memory.close();
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
