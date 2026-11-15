import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';

// Real SQLite exercises persisted rows and deletion queries, not device encryption or Keychain.
const embedder = {
  embed: async (texts: string[]) => texts.map(() => new Float32Array([1, 0])),
};
const input = {
  memoryKey: 'synthetic-reviewed-questions',
  text: 'Synthetic reviewed appointment questions',
  kind: 'reviewed_interaction' as const,
  provenance: {
    sourceIds: ['synthetic-source'],
    reviewState: 'human_reviewed' as const,
  },
};

it('enumerates reviewed durable memory after reopening the adapter without another embedding', async () => {
  const fixture = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(fixture.database);
    const storage = new SqlCipherAgentMemoryStorage(fixture.database);
    expect(await listSavedMemories(storage)).toEqual([]);
    const embed = jest.fn(embedder.embed);
    const memory = await createAgentMemory({ storage, embedder: { embed } });
    await memory.remember(input);
    await memory.close();
    embed.mockClear();
    const rows = await listSavedMemories(
      new SqlCipherAgentMemoryStorage(fixture.database),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(input);
    expect(embed).not.toHaveBeenCalled();
  } finally {
    fixture.close();
  }
});

it('keeps private namespaces and deleted-source rows out of the browser', async () => {
  const fixture = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(fixture.database);
    const storage = new SqlCipherAgentMemoryStorage(fixture.database);
    const privateMemory = await createAgentMemory({
      storage,
      embedder,
      namespace: ['synthetic-private'],
    });
    await privateMemory.remember(input);
    await privateMemory.close();
    expect(await listSavedMemories(storage)).toEqual([]);
    const memory = await createAgentMemory({ storage, embedder });
    await memory.remember(input);
    await memory.close();
    expect(await listSavedMemories(storage)).toHaveLength(1);
    await storage.markSourceRemoved('synthetic-source');
    expect(
      await listSavedMemories(
        new SqlCipherAgentMemoryStorage(fixture.database),
      ),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});
