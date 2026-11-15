import { recoverConversationHealthHistory } from '../recoverConversationHealthHistory';
import { runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { saveConversationHealthHistory } from '../conversationHealthHistory';

const input = {
  requestId: 'synthetic-action',
  sessionId: 'synthetic-session',
  sessionVersion: 1,
  question: '과거 건강 기록으로 저장해: 예전에 수술한 것 같아요.',
  operation: { operationRunId: 'run-1', operationKey: 'tool-1' },
};

async function fixture() {
  const db = createHealthEvidenceTestDatabase();
  await runMigrations(db.database);
  await db.database.execute(
    'CREATE TABLE conversation_artifact_sessions (id TEXT PRIMARY KEY, version INTEGER, hidden INTEGER)',
  );
  await db.database.execute(
    'CREATE TABLE conversation_requests (id TEXT PRIMARY KEY, session_id TEXT, session_version INTEGER, question TEXT, status TEXT)',
  );
  await db.database.execute(
    'INSERT INTO conversation_artifact_sessions VALUES (?, 1, 0)',
    [input.sessionId],
  );
  await db.database.execute(
    "INSERT INTO conversation_requests VALUES (?, ?, 1, ?, 'active')",
    [input.requestId, input.sessionId, input.question],
  );
  return db;
}

// Real SQLite proves receipt and domain data move together, not a mocked API.
test('binds one write to its original run and operation without replaying a different invocation', async () => {
  const { database, close } = await fixture();
  const signal = new AbortController().signal;
  try {
    expect(
      await recoverConversationHealthHistory(database, input, signal),
    ).toBeUndefined();
    const id = await saveConversationHealthHistory(database, input, signal);
    expect(await saveConversationHealthHistory(database, input, signal)).toBe(
      id,
    );
    expect(
      await recoverConversationHealthHistory(database, input, signal),
    ).toBe(id);
    expect(
      (
        await database.execute(
          'SELECT identity_json FROM conversation_action_receipts',
        )
      ).rows[0].identity_json,
    ).not.toContain('수술');
    expect(
      await recoverConversationHealthHistory(
        database,
        {
          ...input,
          operation: { operationRunId: 'wrong', operationKey: 'tool-1' },
        },
        signal,
      ),
    ).toBeUndefined();
    for (const operation of [
      { operationRunId: 'run-2', operationKey: 'tool-1' },
      { operationRunId: 'run-1', operationKey: 'tool-2' },
    ]) {
      await expect(
        saveConversationHealthHistory(
          database,
          { ...input, operation },
          signal,
        ),
      ).rejects.toThrow('another or unknown execution');
    }
    expect(
      (await database.execute('SELECT id FROM manual_history_entries')).rows,
    ).toHaveLength(1);
    await database.execute(
      'UPDATE conversation_requests SET question = ? WHERE id = ?',
      ['changed', input.requestId],
    );
    await expect(
      recoverConversationHealthHistory(database, input, signal),
    ).rejects.toThrow('no longer active');
    await database.execute(
      'UPDATE conversation_requests SET question = ? WHERE id = ?',
      [input.question, input.requestId],
    );
    await database.execute('DELETE FROM manual_history_entries WHERE id = ?', [
      id,
    ]);
    await expect(
      saveConversationHealthHistory(database, input, signal),
    ).rejects.toThrow('removed or changed');
    expect(
      await recoverConversationHealthHistory(database, input, signal),
    ).toBeUndefined();
    expect(
      (await database.execute('SELECT id FROM manual_history_entries')).rows,
    ).toHaveLength(0);
  } finally {
    close();
  }
});

test('does not attach new identity to a legacy receipt and rolls back invalid identities', async () => {
  const { database, close } = await fixture();
  const signal = new AbortController().signal;
  try {
    await expect(
      saveConversationHealthHistory(
        database,
        { ...input, operation: { operationRunId: '', operationKey: 'tool-1' } },
        signal,
      ),
    ).rejects.toThrow('exact action execution');
    expect(
      (await database.execute('SELECT id FROM manual_history_entries')).rows,
    ).toHaveLength(0);
    await saveConversationHealthHistory(
      database,
      { ...input, operation: undefined },
      signal,
    );
    await expect(
      saveConversationHealthHistory(database, input, signal),
    ).rejects.toThrow('another or unknown execution');
    expect(
      (await database.execute('SELECT id FROM manual_history_entries')).rows,
    ).toHaveLength(1);
  } finally {
    close();
  }
});

test('rolls back the execution binding when the domain insert cannot commit', async () => {
  const { database, close } = await fixture();
  const signal = new AbortController().signal;
  try {
    await database.execute(
      "CREATE TRIGGER reject_synthetic_history BEFORE INSERT ON manual_history_entries BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END",
    );
    await expect(
      saveConversationHealthHistory(database, input, signal),
    ).rejects.toThrow();
    expect(
      (await database.execute('SELECT id FROM manual_history_entries')).rows,
    ).toHaveLength(0);
    await database.execute('DROP TRIGGER reject_synthetic_history');
    // If the binding escaped the transaction, this different identity is rejected.
    await expect(
      saveConversationHealthHistory(
        database,
        {
          ...input,
          operation: { operationRunId: 'new-run', operationKey: 'tool-1' },
        },
        signal,
      ),
    ).resolves.toBe('conversation-history:' + input.requestId);
    await database.execute(
      'DELETE FROM conversation_artifact_sessions WHERE id = ?',
      [input.sessionId],
    );
    expect(
      (await database.execute('SELECT * FROM conversation_action_receipts'))
        .rows,
    ).toHaveLength(0);
  } finally {
    close();
  }
});

test('does not release a recovered ID after cancellation at transaction resolution', async () => {
  const { database, close } = await fixture();
  const controller = new AbortController();
  try {
    await saveConversationHealthHistory(database, input, controller.signal);
    const recovering = {
      execute: database.execute.bind(database),
      async transaction(
        work: Parameters<typeof database.transaction>[0],
      ): Promise<void> {
        const result = await database.transaction(work);
        controller.abort();
        return result;
      },
    };
    expect(
      await recoverConversationHealthHistory(
        recovering,
        input,
        controller.signal,
      ),
    ).toBeUndefined();
  } finally {
    close();
  }
});
