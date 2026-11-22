import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { enqueueManualHistoryMemory } from '../../storage/userStatementMemoryJobs';
import {
  enqueueExistingHistoryMemories,
  processStatementMemoryJobs,
} from '../userStatementMemoryProcessing';

const autoId = 'conversation-local-memory:auto:synthetic-original';
const explicitId = 'conversation-local-memory:synthetic-explicit';
const manualId = 'manual-history-synthetic';
const draft = {
  kind: 'note',
  title: 'Synthetic note',
  effectiveDate: { status: 'unknown' },
} as const;

async function fixture() {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  const storage = new SqlCipherAgentMemoryStorage(f.database);
  expect(await listSavedMemories(storage)).toEqual([]);
  const ids = [autoId, explicitId, manualId, 'synthetic-correction'];
  const history = createManualHistoryRepository(f.database, {
    createId: () => ids.shift()!,
  });
  await history.create({ ...draft, details: 'Synthetic automatic original' });
  await history.create({
    ...draft,
    details: 'Synthetic explicit local original',
  });
  await history.create({ ...draft, details: 'Synthetic ordinary record' });
  const jobs = async () =>
    (
      await f.database.execute(
        "SELECT source_id FROM user_statement_memory_jobs WHERE source_kind = 'manual_history' ORDER BY source_id",
      )
    ).rows.map(row => row.source_id);
  return { ...f, history, jobs, storage };
}

test('direct enqueue and startup backfill skip only the automatic local origin', async () => {
  const f = await fixture();
  try {
    for (const id of [autoId, explicitId])
      await f.database.transaction(tx => enqueueManualHistoryMemory(tx, id));
    expect(await f.jobs()).toEqual([explicitId]);
    await enqueueExistingHistoryMemories(f.database);
    expect(await f.jobs()).toEqual([explicitId, manualId]);
    expect((await f.history.get(autoId))?.details).toBe(
      'Synthetic automatic original',
    );
    expect(await f.history.getEvidence(autoId)).toBeNull();
  } finally {
    f.close();
  }
});

test('a stale queued automatic job never invokes embedding; nearby explicit and ordinary jobs still do', async () => {
  const f = await fixture();
  try {
    await enqueueExistingHistoryMemories(f.database);
    // Simulate a persisted job from an older worker, not the hardened enqueue path.
    await f.database.execute(
      "INSERT OR IGNORE INTO user_statement_memory_jobs (source_kind, source_id) VALUES ('manual_history', ?)",
      [autoId],
    );
    const embed = jest.fn(async (texts: string[]) =>
      texts.map(() => new Float32Array([1, 0])),
    );
    const memory = await createAgentMemory({
      storage: f.storage,
      embedder: { embed },
    });
    try {
      expect(await processStatementMemoryJobs(f.database, memory)).toEqual({
        failed: 0,
      });
      const embeddedText = embed.mock.calls.flatMap(([texts]) => texts);
      expect(embeddedText).toHaveLength(2);
      expect(embeddedText).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Synthetic explicit local original'),
          expect.stringContaining('Synthetic ordinary record'),
        ]),
      );
      expect(
        (await listSavedMemories(f.storage)).map(saved => saved.text),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Synthetic explicit local original'),
          expect.stringContaining('Synthetic ordinary record'),
        ]),
      );
      expect(await f.jobs()).toEqual([]);
      await enqueueExistingHistoryMemories(f.database);
      expect(await f.jobs()).toEqual([]);
    } finally {
      await memory.close();
    }
  } finally {
    f.close();
  }
});

test('a correction retains the exact automatic namespace and cannot become a later memory job', async () => {
  const f = await fixture();
  try {
    const corrected = await f.history.correct(autoId, {
      ...draft,
      details: 'Synthetic automatic correction',
    });
    expect(corrected.id).toBe(
      'conversation-local-memory:auto:synthetic-correction',
    );
    expect(corrected.supersedesId).toBe(autoId);
    await f.database.transaction(tx =>
      enqueueManualHistoryMemory(tx, corrected.id),
    );
    await enqueueExistingHistoryMemories(f.database);
    expect(await f.jobs()).toEqual([explicitId, manualId]);
    expect(await f.history.getEvidence(corrected.id)).toBeNull();
    expect(await f.history.delete(corrected.id)).toBe(true);
    expect(await f.history.get(corrected.id)).toBeNull();
    expect(await f.history.get(autoId)).toBeNull();
    expect(await f.history.get(explicitId)).not.toBeNull();
    expect(await f.history.get(manualId)).not.toBeNull();
  } finally {
    f.close();
  }
});
