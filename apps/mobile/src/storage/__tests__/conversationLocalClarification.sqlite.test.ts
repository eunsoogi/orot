import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import { t } from '../../i18n';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

const identity = {
  id: 'local-turn',
  sessionId: 'owned',
  sessionVersion: 0,
  question: 'Synthetic authored question',
  createdAt: '2026-11-22T00:00:00.000Z',
};
const approved = { callId: 'reviewed', text: 'Synthetic approved opening.' };

test('local clarification remains in the display timeline only and cannot be promoted into an ordinary artifact', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    const generation = await storage.currentGeneration();
    await storage.createSession(identity.sessionId, generation);
    await storage.createSession('foreign', generation);
    await storage.startRequest(identity);
    const input = {
      ...identity,
      version: 0,
      display: { initialResponse: approved },
      current: () => true,
      signal: new AbortController().signal,
    };
    await expect(
      storage.completeLocalClarification({ ...input, sessionId: 'foreign' }),
    ).rejects.toThrow();
    await expect(
      storage.completeLocalClarification({ ...input, version: 1 }),
    ).rejects.toThrow();
    await storage.completeLocalClarification(input);
    await expect(storage.completeLocalClarification(input)).rejects.toThrow();
    await expect(
      storage.append({
        ...identity,
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete',
        answer: 'Not a valid replacement',
        sources: [],
        citations: [],
      }),
    ).rejects.toThrow();
    expect(await storage.read(identity.id)).toBeNull();
    expect(
      await storage.listInterruptedRequests(identity.sessionId, 0),
    ).toEqual([]);
    expect(await storage.listCompletionIdentities()).toEqual([]);
    expect((await storage.listTimeline(identity.sessionId, 0)).items).toEqual(
      [],
    );
    expect(
      (
        await storage.listTimeline(
          identity.sessionId,
          0,
          undefined,
          undefined,
          true,
        )
      ).items,
    ).toMatchObject([{ id: identity.id, kind: 'turn' }]);
    expect(
      await storage.readSessionPresentationMany('foreign', 0, [identity.id]),
    ).toEqual([null]);
    expect(
      await storage.readSessionPresentationMany(identity.sessionId, 0, [
        identity.id,
      ]),
    ).toMatchObject([
      {
        answer: t('visitQuestions.conversation.clarifyGoal'),
        initialResponse: approved,
      },
    ]);
    await storage.hideSession(identity.sessionId, 0);
    await expect(
      storage.readSessionPresentationMany(identity.sessionId, 0, [identity.id]),
    ).rejects.toThrow();
    await storage.deleteSession(identity.sessionId);
    expect(
      (
        await db.database.execute(
          'SELECT local_outcome_json FROM conversation_requests',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    db.close();
  }
});

test.each(['stop', 'owner-change'] as const)(
  'blocks %s after a real staged SQLite update and preserves interruption ownership',
  async reason => {
    const db = openSqliteTestDatabase(':memory:');
    const stop = new AbortController();
    let current = true;
    let inWrite = false;
    let found = 0;
    const protectedDb: SqlDatabase = {
      execute: db.database.execute,
      transaction: work =>
        db.database.transaction(tx =>
          work({
            ...tx,
            async execute(query, bindings) {
              const result = await tx.execute(query, bindings);
              if (inWrite && query.includes('local_outcome_json = ?')) {
                found += result.rowsAffected ?? 0;
                if (reason === 'stop') stop.abort();
                else current = false;
              }
              return result;
            },
          }),
        ),
    };
    try {
      await runMigrations(protectedDb);
      const storage = createConversationArtifactStorage(protectedDb);
      await storage.createSession(
        identity.sessionId,
        await storage.currentGeneration(),
      );
      await storage.startRequest(identity);
      inWrite = true;
      await expect(
        storage.completeLocalClarification({
          ...identity,
          version: 0,
          display: { initialResponse: approved },
          current: () => current,
          signal: stop.signal,
        }),
      ).rejects.toThrow();
      expect(found).toBe(1);
      expect(
        (
          await db.database.execute(
            'SELECT status, local_outcome_json FROM conversation_requests',
          )
        ).rows,
      ).toEqual([{ status: 'active', local_outcome_json: null }]);
      await storage.interruptRequest(
        identity.id,
        identity.sessionId,
        0,
        'interrupted',
        'user-stopped',
      );
      expect(
        await storage.readSessionPresentationMany(identity.sessionId, 0, [
          identity.id,
        ]),
      ).toMatchObject([
        { status: 'interrupted', interruptionReason: 'user-stopped' },
      ]);
      expect(await storage.listCompletionIdentities()).toEqual([]);
    } finally {
      db.close();
    }
  },
);
