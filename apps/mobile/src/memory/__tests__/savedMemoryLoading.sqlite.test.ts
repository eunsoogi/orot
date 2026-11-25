import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';

import { manualHistoryMemory } from '../userStatementMemory';
import { unifySavedMemories } from '../unifiedSavedMemories';

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

it('does not reopen a held manual projection after its original is corrected or deleted', async () => {
  const fixture = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(fixture.database);
    const history = createManualHistoryRepository(fixture.database);
    const storage = new SqlCipherAgentMemoryStorage(fixture.database);
    const memory = await createAgentMemory({ storage, embedder });
    const original = await history.create({
      kind: 'note',
      title: 'Synthetic original',
      details: 'Replaced text',
      effectiveDate: { status: 'unknown' },
    });
    await memory.remember(manualHistoryMemory(original));
    await memory.remember({ ...input, text: original.details });
    // The two loaders can observe different commits. Simulate a projection
    // read completed just before the authoritative original changed.
    const held = await listSavedMemories(storage);
    expect(held).toHaveLength(2);
    const corrected = await history.correct(original.id, {
      kind: 'note',
      title: 'Synthetic correction',
      details: 'Current corrected text',
      effectiveDate: { status: 'known', date: '2026-11-01' },
    });
    expect(await listSavedMemories(storage)).toHaveLength(1);
    expect(unifySavedMemories(held, await history.list())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manual-history:' + corrected.id,
          record: expect.objectContaining({
            supersedesId: original.id,
            effectiveDate: corrected.effectiveDate,
          }),
        }),
        expect.objectContaining({ memoryKey: input.memoryKey }),
      ]),
    );
    expect(unifySavedMemories(held, await history.list())).toHaveLength(2);
    expect(await history.delete(corrected.id)).toBe(true);
    expect(unifySavedMemories(held, await history.list())).toEqual([
      expect.objectContaining({ memoryKey: input.memoryKey }),
    ]);
    await memory.close();
  } finally {
    fixture.close();
  }
});
