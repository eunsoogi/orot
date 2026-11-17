import { runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';
import { ensureStatementMemoryJobs } from '../../storage/userStatementMemoryJobs';
const model = { providerId: 'synthetic', modelId: 'model-a' };
const now = '2026-11-16T00:00:00.000Z';
async function fixture() {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  const storage = createConversationArtifactStorage(f.database);
  const lease = await storage.continuousSession(
    model,
    'session',
    now,
    new AbortController().signal,
  );
  const turn: ConversationArtifact = {
    ...model,
    id: 'turn',
    sessionId: lease.id,
    createdAt: now,
    status: 'complete',
    question: '저는 짧은 설명을 선호합니다',
    answer: 'Synthetic answer',
    sources: [],
  };
  await ensureStatementMemoryJobs(f.database);
  const jobs = async () =>
    (
      await f.database.execute(
        'SELECT source_id FROM user_statement_memory_jobs',
      )
    ).rows;
  return { ...f, storage, lease, turn, jobs };
}
// Real SQLite proves the shared artifact transaction, not only independent module mocks.
test('continuous session reopen preserves one source job with the same authored turn', async () => {
  const f = await fixture();
  try {
    await f.storage.append(f.turn, undefined, f.lease.version);
    const reopened = createConversationArtifactStorage(f.database);
    expect(
      (
        await reopened.continuousSession(
          model,
          'unused',
          now,
          new AbortController().signal,
        )
      ).id,
    ).toBe(f.lease.id);
    await reopened.append(f.turn, undefined, f.lease.version);
    expect(await f.jobs()).toEqual([{ source_id: f.turn.id }]);
  } finally {
    f.close();
  }
});
test('cancelled append and deleted continuous lease cannot enqueue or recreate a turn', async () => {
  const f = await fixture();
  try {
    const abort = new AbortController();
    abort.abort();
    await expect(
      f.storage.append(f.turn, abort.signal, f.lease.version),
    ).rejects.toThrow();
    expect(await f.jobs()).toEqual([]);
    await f.storage.append(f.turn);
    await f.storage.deleteSession(f.lease.id);
    expect(await f.jobs()).toEqual([]);
    await expect(f.storage.append(f.turn)).rejects.toThrow();
    await expect(
      f.storage.continuousSession(
        model,
        'replacement',
        now,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(await f.jobs()).toEqual([]);
  } finally {
    f.close();
  }
});
test('failed enqueue rolls back the answer while preserving the prior continuous lease', async () => {
  const f = await fixture();
  try {
    await f.database.execute(
      "CREATE TRIGGER synthetic_queue_failure BEFORE INSERT ON user_statement_memory_jobs BEGIN SELECT RAISE(ABORT, 'Synthetic queue failure'); END",
    );
    await expect(f.storage.append(f.turn)).rejects.toThrow(
      'Synthetic queue failure',
    );
    expect(
      (await f.database.execute('SELECT id FROM conversation_artifacts')).rows,
    ).toEqual([]);
    expect(await f.jobs()).toEqual([]);
    expect(
      (
        await f.storage.continuousSession(
          model,
          'unused',
          now,
          new AbortController().signal,
        )
      ).id,
    ).toBe(f.lease.id);
  } finally {
    f.close();
  }
});
test('generation clear removes both the continuous pointer and pending source identities', async () => {
  const f = await fixture();
  try {
    await f.storage.append(f.turn);
    await f.database.execute(
      'UPDATE conversation_artifact_generation SET generation = generation + 1 WHERE singleton = 1',
    );
    expect(await f.jobs()).toEqual([]);
    expect(
      (await f.database.execute('SELECT * FROM conversation_active_model'))
        .rows,
    ).toEqual([]);
    await expect(f.storage.append(f.turn)).rejects.toThrow();
  } finally {
    f.close();
  }
});
