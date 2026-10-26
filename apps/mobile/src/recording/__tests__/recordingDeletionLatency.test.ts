import { createAgentMemory } from '@orot/agent-memory';
import type { AgentMemoryService } from '@orot/agent-memory';
import { openEncryptedStorage } from '@orot/storage';
import {
  audioSourceRecord,
  createDatabase,
  options,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import {
  openLocalStorage,
  openLocalAgentMemoryDatabase,
} from '../../storage/secureDatabase';
import { openOrReuseLocalAgentMemory } from '../../memory/localAgentMemory';
import { createRecordingLibraryService } from '../recordingLibraryService';
import { removeLocalSourceWithMemory } from '../../memory/removeSourceWithMemory';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../memory/localAgentMemory', () => ({
  openOrReuseLocalAgentMemory: jest.fn(),
}));
// Recognition and E5 are outside this fixture: persisted vectors use a deterministic local embedder.
jest.mock('../../rag/localE5NativeBackend', () => ({
  localE5NativeBackend: {},
}));

const embedder = {
  async embed(texts: string[]) {
    return texts.map((_, index) => Float32Array.from([1, index + 1, 0, 0]));
  },
};
type Measurement = {
  totalMs: number;
  memoryOpenMs: number;
  memoryCascadeMs: number;
  sqlStatements: number;
  schemaStatements: number;
};

async function measurePair(
  count: number,
): Promise<{ cold: Measurement; warm: Measurement }> {
  const database = createDatabase();
  const repository = await openEncryptedStorage(options(database));
  const storage = new SqlCipherAgentMemoryStorage(database);
  let memory: AgentMemoryService | undefined = await createAgentMemory({
    embedder,
    storage,
  });
  for (const [ordinal, sourceId] of [
    'cold-recording',
    'warm-recording',
    'retained-recording',
  ].entries()) {
    await repository.sourceRecords.create({
      ...audioSourceRecord(sourceId),
      contentHash: `sha256:${String(ordinal + 1).repeat(64)}`,
    });
    for (let index = 0; index < count; index += 1) {
      await memory.remember({
        memoryKey: `${sourceId}:${index}`,
        text: `Synthetic memory ${sourceId} ${index}`,
        kind: 'task_context',
        provenance: { sourceIds: [sourceId], reviewState: 'human_reviewed' },
      });
    }
  }
  await memory.close();
  memory = undefined;
  const execute = jest.spyOn(database, 'execute');
  let transactionStatements = 0;
  const transaction = database.transaction.bind(database);
  jest.spyOn(database, 'transaction').mockImplementation(operation =>
    transaction(async executor => {
      const run = executor.execute.bind(executor);
      executor.execute = async (...args) => {
        transactionStatements += 1;
        return run(...args);
      };
      await operation(executor);
    }),
  );
  let memoryOpenMs = 0;
  let memoryCascadeMs = 0;
  jest.mocked(openLocalStorage).mockResolvedValue(repository);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  jest.mocked(openOrReuseLocalAgentMemory).mockImplementation(async () => {
    const start = performance.now();
    if (!memory) {
      memory = await createAgentMemory({
        embedder,
        storage: new SqlCipherAgentMemoryStorage(database),
      });
      const remove = memory.removeSource.bind(memory);
      jest.spyOn(memory, 'removeSource').mockImplementation(async (...args) => {
        const began = performance.now();
        try {
          return await remove(...args);
        } finally {
          memoryCascadeMs += performance.now() - began;
        }
      });
    }
    memoryOpenMs += performance.now() - start;
    return memory;
  });
  const staged = new Set<string>();
  const service = createRecordingLibraryService({
    // Inject only module/native boundaries. Timings include the real cascade and SQLite,
    // but exclude native audio I/O and the default loader's separate provider preparation.
    loadRepository: async () => repository,
    openMemory: () => openOrReuseLocalAgentMemory({} as never),
    removeSource: removeLocalSourceWithMemory,
    assertRecordingStopped: async () => {},
    audioDeletion: {
      reconcile: async () => {},
      stage: async id => {
        staged.add(id);
      },
      restore: async id => {
        staged.delete(id);
      },
      commit: async id => {
        staged.delete(id);
      },
    },
  });
  async function measure(sourceId: string): Promise<Measurement> {
    execute.mockClear();
    transactionStatements = 0;
    memoryOpenMs = 0;
    memoryCascadeMs = 0;
    const start = performance.now();
    await service.deleteRecording(sourceId);
    const totalMs = performance.now() - start;
    const measured = {
      totalMs,
      memoryOpenMs,
      memoryCascadeMs,
      sqlStatements: execute.mock.calls.length + transactionStatements,
      schemaStatements: execute.mock.calls.filter(([sql]) =>
        sql.startsWith('CREATE TABLE IF NOT EXISTS rag_embedding'),
      ).length,
    };
    expect(await repository.get('source_record', sourceId)).toBeNull();
    expect(staged.size).toBe(0);
    return measured;
  }
  async function closeMemory(): Promise<void> {
    await memory?.close();
  }
  try {
    const cold = await measure('cold-recording');
    const warm = await measure('warm-recording');
    expect(
      await repository.get('source_record', 'retained-recording'),
    ).not.toBeNull();
    const remaining = await storage.load();
    expect(remaining).toHaveLength(count);
    expect(
      (
        await database.execute(
          'SELECT source_record_id FROM rag_embedding_removed_sources ORDER BY source_record_id',
        )
      ).rows,
    ).toEqual([
      { source_record_id: 'cold-recording' },
      { source_record_id: 'warm-recording' },
    ]);
    const fences = (
      await database.execute(
        'SELECT source_id FROM agent_memory_removed_sources',
      )
    ).rows.map(row => row.source_id);
    expect(fences).toEqual(
      expect.arrayContaining(['cold-recording', 'warm-recording']),
    );
    return { cold, warm };
  } finally {
    await closeMemory();
    await database.closeAsync?.();
    jest.restoreAllMocks();
  }
}

test.each([0, 20, 100])(
  'measures cold/warm deletion with %i synthetic memories per source',
  async count => {
    const samples = [];
    for (let trial = 0; trial < 3; trial += 1)
      samples.push(await measurePair(count));
    console.info(
      'recording-deletion-benchmark',
      JSON.stringify({ count, samples }),
    );
    // Preparation is database-scoped; a warm deletion must not re-run schema preparation.
    expect(samples.every(sample => sample.warm.schemaStatements === 0)).toBe(
      true,
    );
  },
  30000,
);
