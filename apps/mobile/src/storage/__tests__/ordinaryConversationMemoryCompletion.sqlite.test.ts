import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import {
  hasOrdinaryConversationCompletedSource,
  type OrdinaryConversationCompletionIdentity,
} from '../ordinaryConversationMemoryCompletion';

const identity = {
  requestId: 'synthetic-request',
  sessionId: 'synthetic-session',
  sessionVersion: 0,
  question: 'For future, use a concise project status.',
  createdAt: '2026-11-22T00:00:00.000Z',
};
const { requestId: id, sessionId, question, createdAt } = identity;
const artifact = {
  id,
  sessionId,
  question,
  createdAt,
  providerId: 'synthetic-provider',
  modelId: 'synthetic-model',
  answer: 'Synthetic completion.',
  status: 'complete' as const,
  sources: [],
};

async function fixture() {
  const sqlite = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(sqlite.database);
    const retained = createConversationArtifactStorage(sqlite.database);
    await retained.createSession(sessionId, await retained.currentGeneration());
    return {
      ...sqlite,
      retained,
      async matches(
        candidate: OrdinaryConversationCompletionIdentity = identity,
      ) {
        let matched = false;
        await sqlite.database.transaction(async tx => {
          matched = await hasOrdinaryConversationCompletedSource(tx, candidate);
        });
        return matched;
      },
      start() {
        return retained.startRequest({ ...identity, id });
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

test('requires the exact authored bytes, checkpoint, completion and retained identity', async () => {
  const f = await fixture();
  try {
    expect(await f.matches()).toBe(false);
    await f.start();
    expect(await f.matches()).toBe(false);
    await f.retained.append(artifact);
    expect(await f.matches()).toBe(true);
    expect(await f.matches({ ...identity, entryIntent: 'possibilities' })).toBe(
      false,
    );
    expect(
      await f.matches({ ...identity, question: question.toLowerCase() }),
    ).toBe(false);
    expect(await f.matches({ ...identity, sessionVersion: 1 })).toBe(false);
    expect(await f.matches({ ...identity, requestId: 'foreign' })).toBe(false);
    expect(
      await f.matches({ ...identity, createdAt: '2026-11-22T00:00:01.000Z' }),
    ).toBe(false);
    await f.retained.deleteSession(sessionId);
    expect(await f.matches()).toBe(false);
  } finally {
    f.close();
  }
});

test('legacy outputs stay ineligible and typed rows require the exact live entry mode', async () => {
  const legacy = await fixture();
  try {
    await legacy.retained.append(artifact);
    expect(await legacy.retained.read(id)).not.toBeNull();
    expect(await legacy.matches()).toBe(false);
  } finally {
    legacy.close();
  }
  const typed = await fixture();
  try {
    await typed.start();
    await typed.retained.append({ ...artifact, entryIntent: 'possibilities' });
    expect(await typed.retained.read(id)).not.toBeNull();
    expect(await typed.matches()).toBe(false);
    expect(
      await typed.matches({ ...identity, entryIntent: 'possibilities' }),
    ).toBe(true);
  } finally {
    typed.close();
  }
});

test('recovery mode and replaced visible session revoke the optional source without altering its answer', async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.retained.append(artifact);
    expect(await f.matches()).toBe(true);
    await f.database.execute(
      "UPDATE conversation_requests SET interruption_reason = 'app-terminated' WHERE id = ?",
      [id],
    );
    expect(await f.matches()).toBe(false);
    await f.database.execute(
      'UPDATE conversation_requests SET interruption_reason = NULL WHERE id = ?',
      [id],
    );
    await f.database.execute(
      'UPDATE conversation_artifact_sessions SET version = 1 WHERE id = ?',
      [sessionId],
    );
    expect(await f.matches()).toBe(false);
    expect((await f.retained.read(id))?.answer).toBe(artifact.answer);
  } finally {
    f.close();
  }
});

test('a retained treatment-context answer is not a standalone automatic memory source', async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.retained.append({
      ...artifact,
      treatmentContext: {
        version: 1,
        conditions: [],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: [],
        conflicts: [],
      },
    });
    expect((await f.retained.read(id))?.treatmentContext).toBeDefined();
    expect(await f.matches()).toBe(false);
  } finally {
    f.close();
  }
});
