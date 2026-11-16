import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import {
  processStatementMemoryJobs,
  enqueueExistingHistoryMemories,
} from '../userStatementMemoryProcessing';
import { conversationStatementMemory } from '../userStatementMemory';
import { buildMemoryEvidence } from '../../aiFeatures/integration/memoryEvidence';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';
const turn: ConversationArtifact = {
  id: 'turn',
  sessionId: 'session',
  createdAt: '2026-11-01T10:00:00.000Z',
  providerId: 'synthetic',
  modelId: 'synthetic',
  status: 'complete',
  question: '저는 짧은 설명을 선호합니다',
  answer: 'Synthetic',
  sources: [],
};
async function fixture() {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  const artifact = createConversationArtifactStorage(f.database);
  await artifact.createSession(
    turn.sessionId,
    await artifact.currentGeneration(),
  );
  const storage = new SqlCipherAgentMemoryStorage(f.database);
  const embed = jest.fn(async (texts: string[]) =>
    texts.map(() => new Float32Array([1, 0])),
  );
  const memory = await createAgentMemory({ storage, embedder: { embed } });
  return { ...f, artifact, storage, memory, embed };
}
test('answer commit queues memory, drains locally, survives reopen and is recalled as unreviewed', async () => {
  const f = await fixture();
  try {
    await f.artifact.append(turn);
    expect(
      (await f.database.execute('SELECT * FROM user_statement_memory_jobs'))
        .rows,
    ).toHaveLength(1);
    await processStatementMemoryJobs(f.database, f.memory);
    await processStatementMemoryJobs(f.database, f.memory);
    const rows = await listSavedMemories(f.storage);
    expect(rows).toHaveLength(1);
    expect(rows[0].provenance.reviewState).toBe('user_stated');
    const records = await f.storage.listRecords();
    const built = await buildMemoryEvidence({
      records,
      storage: f.storage,
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(built.items).toHaveLength(1);
    expect(built.items[0].reviewState).toBe('unreviewed');
    expect(built.items[0].effectiveTime).toBe(turn.createdAt);
    await f.memory.close();
    expect(
      await listSavedMemories(new SqlCipherAgentMemoryStorage(f.database)),
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});
test('hidden/deleted source removes memory and rejects a late retry', async () => {
  const f = await fixture();
  try {
    await f.artifact.append(turn);
    await processStatementMemoryJobs(f.database, f.memory);
    await f.artifact.hideSession(turn.sessionId);
    expect(await listSavedMemories(f.storage)).toEqual([]);
    await expect(
      f.memory.remember(conversationStatementMemory(turn)!),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
test('legacy migration keeps originals and removes superseded/deleted projections', async () => {
  const f = await fixture();
  try {
    const history = createManualHistoryRepository(f.database);
    const original = await history.create({
      kind: 'note',
      title: 'Synthetic',
      details: 'Uncertain history',
      effectiveDate: { status: 'unknown' },
    });
    await enqueueExistingHistoryMemories(f.database);
    await processStatementMemoryJobs(f.database, f.memory);
    expect(await history.get(original.id)).not.toBeNull();
    expect(await listSavedMemories(f.storage)).toHaveLength(1);
    const corrected = await history.correct(original.id, {
      kind: 'note',
      title: 'Corrected',
      details: 'No longer the original statement',
      effectiveDate: { status: 'unknown' },
    });
    expect(await listSavedMemories(f.storage)).toHaveLength(0);
    expect(await f.memory.recall(original.details)).toEqual([]);
    await enqueueExistingHistoryMemories(f.database);
    await processStatementMemoryJobs(f.database, f.memory);
    expect((await listSavedMemories(f.storage))[0].text).toContain(
      corrected.details,
    );
    await history.delete(corrected.id);
    expect(await listSavedMemories(f.storage)).toEqual([]);
  } finally {
    f.close();
  }
});
test('embedding failure preserves a retry job without failing the already committed answer', async () => {
  const f = await fixture();
  try {
    await f.artifact.append(turn);
    const remember = jest
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic embedding unavailable'))
      .mockImplementation(value => f.memory.remember(value));
    expect(await processStatementMemoryJobs(f.database, { remember })).toEqual({
      failed: 1,
    });
    expect(await f.artifact.read(turn.id)).not.toBeNull();
    await processStatementMemoryJobs(f.database, { remember });
    expect(await listSavedMemories(f.storage)).toHaveLength(1);
  } finally {
    f.close();
  }
});

test('exact repeats remain one memory while a changed statement stays separately dated', async () => {
  const f = await fixture();
  try {
    await f.artifact.append(turn);
    await processStatementMemoryJobs(f.database, f.memory);
    await f.artifact.append({
      ...turn,
      id: 'repeat',
      createdAt: '2026-11-02T10:00:00.000Z',
    });
    await processStatementMemoryJobs(f.database, f.memory);
    expect(await listSavedMemories(f.storage)).toHaveLength(1);
    await f.artifact.append({
      ...turn,
      id: 'changed',
      createdAt: '2026-11-03T10:00:00.000Z',
      question: '저는 이제 자세한 설명을 선호합니다',
    });
    await processStatementMemoryJobs(f.database, f.memory);
    expect(await listSavedMemories(f.storage)).toHaveLength(2);
  } finally {
    f.close();
  }
});

test('source deletion during embedding cannot recreate memory after its original is gone', async () => {
  const f = await fixture();
  try {
    await f.artifact.append(turn);
    f.embed.mockImplementationOnce(async texts => {
      await f.artifact.deleteSession(turn.sessionId);
      return texts.map(() => new Float32Array([1, 0]));
    });
    expect(await processStatementMemoryJobs(f.database, f.memory)).toEqual({
      failed: 1,
    });
    expect(await listSavedMemories(f.storage)).toEqual([]);
    expect(
      (await f.database.execute('SELECT * FROM user_statement_memory_jobs'))
        .rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});

test('closing a still-cached service after source deletion cannot compact memory back into storage', async () => {
  const f = await fixture();
  try {
    await f.artifact.append(turn);
    await processStatementMemoryJobs(f.database, f.memory);
    await f.artifact.deleteSession(turn.sessionId);
    await f.memory.close();
    const reopened = await createAgentMemory({
      storage: new SqlCipherAgentMemoryStorage(f.database),
      embedder: { embed: f.embed },
    });
    expect(await reopened.recall(turn.question)).toEqual([]);
    expect(await listSavedMemories(f.storage)).toEqual([]);
    await reopened.close();
  } finally {
    f.close();
  }
});

test('statement-time SQL guard rejects a cached record after source removal even without JS validation', async () => {
  const f = await fixture();
  try {
    await f.artifact.append(turn);
    await processStatementMemoryJobs(f.database, f.memory);
    const row = (
      await f.database.execute(
        'SELECT id, record_json FROM agent_memory_records',
      )
    ).rows[0];
    await f.artifact.deleteSession(turn.sessionId);
    await expect(
      f.database.execute(
        'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?)',
        [String(row.id), String(row.record_json)],
      ),
    ).rejects.toThrow('Original user statement is unavailable');
    expect(await listSavedMemories(f.storage)).toEqual([]);
  } finally {
    f.close();
  }
});
