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

// Distinct user sources retain separate exact operation receipts in real SQLite.
test('saves and restores distinct sources while fencing replay, deletion and changed identities', async () => {
  const { database, close } = await fixture();
  const signal = new AbortController().signal;
  try {
    await database.execute(
      'CREATE TABLE conversation_artifacts (id TEXT PRIMARY KEY, session_id TEXT, result_json TEXT)',
    );
    await database.execute(
      'INSERT INTO conversation_artifacts VALUES (?, ?, ?)',
      [
        'prior',
        input.sessionId,
        JSON.stringify({ question: 'Synthetic prior user history' }),
      ],
    );
    const first = await saveConversationHealthHistory(database, input, signal);
    const second = {
      ...input,
      operation: { operationRunId: 'run-1', operationKey: 'tool-3' },
      approvedSource: {
        requestId: 'prior',
        text: 'Synthetic prior user history',
      },
    };
    const id = await saveConversationHealthHistory(database, second, signal);
    expect(id).not.toBe(first);
    expect(await saveConversationHealthHistory(database, second, signal)).toBe(
      id,
    );
    expect(
      await recoverConversationHealthHistory(database, second, signal),
    ).toBe(id);
    expect(
      await recoverConversationHealthHistory(database, input, signal),
    ).toBe(first);
    for (const operation of [
      { operationRunId: 'run-2', operationKey: 'tool-4' },
      { operationRunId: 'run-1', operationKey: 'tool-4' },
      { operationRunId: 'run-1', operationKey: 'tool-2' },
    ]) {
      await expect(
        saveConversationHealthHistory(
          database,
          { ...second, operation },
          signal,
        ),
      ).rejects.toThrow();
    }
    await database.execute('DELETE FROM manual_history_entries WHERE id=?', [
      id,
    ]);
    await expect(
      saveConversationHealthHistory(database, second, signal),
    ).rejects.toThrow('removed or changed');
    expect(
      await recoverConversationHealthHistory(database, second, signal),
    ).toBeUndefined();
    expect(
      (
        await database.execute(
          'SELECT * FROM conversation_history_operation_receipts',
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await database.execute('SELECT * FROM manual_history_entries')).rows,
    ).toHaveLength(1);
  } finally {
    close();
  }
});

test('rejects decreasing ordinals, unknown legacy identities and rolls back receipt failure', async () => {
  const { database, close } = await fixture();
  const signal = new AbortController().signal;
  try {
    await database.execute(
      'CREATE TABLE conversation_artifacts (id TEXT PRIMARY KEY, session_id TEXT, result_json TEXT)',
    );
    for (const id of ['prior', 'third'])
      await database.execute(
        'INSERT INTO conversation_artifacts VALUES (?, ?, ?)',
        [id, input.sessionId, JSON.stringify({ question: id })],
      );
    await saveConversationHealthHistory(database, input, signal);
    const later = (key: string, source: string) => ({
      ...input,
      operation: { operationRunId: 'run-1', operationKey: key },
      approvedSource: { requestId: source, text: source },
    });
    await saveConversationHealthHistory(
      database,
      later('tool-3', 'prior'),
      signal,
    );
    await expect(
      saveConversationHealthHistory(database, later('tool-2', 'third'), signal),
    ).rejects.toThrow();
    await database.execute(
      "CREATE TRIGGER fail_later_receipt BEFORE INSERT ON conversation_history_operation_receipts BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END",
    );
    await expect(
      saveConversationHealthHistory(database, later('tool-4', 'third'), signal),
    ).rejects.toThrow('synthetic receipt failure');
    expect(
      (await database.execute('SELECT * FROM manual_history_entries')).rows,
    ).toHaveLength(2);
    expect(
      (
        await database.execute(
          'SELECT * FROM conversation_history_operation_receipts',
        )
      ).rows,
    ).toHaveLength(1);
    await database.execute('DELETE FROM conversation_action_receipts');
    await expect(
      saveConversationHealthHistory(database, later('tool-4', 'third'), signal),
    ).rejects.toThrow('another or unknown execution');
  } finally {
    close();
  }
});
