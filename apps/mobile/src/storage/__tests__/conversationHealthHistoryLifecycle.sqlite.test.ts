const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...paths: string[]): string };
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { saveConversationHealthHistory } from '../conversationHealthHistory';

const input = {
  requestId: 'r',
  sessionId: 's',
  sessionVersion: 1,
  question: '과거 건강 기록으로 저장해: 예전에 수술했어요.',
};
const signal = new AbortController().signal;
async function setup(path: string) {
  const db = createHealthEvidenceTestDatabase(path);
  await runMigrations(db.database);
  await db.database.execute(
    'CREATE TABLE conversation_artifact_sessions (id TEXT PRIMARY KEY, version INTEGER, hidden INTEGER)',
  );
  await db.database.execute(
    'CREATE TABLE conversation_requests (id TEXT PRIMARY KEY, session_id TEXT, session_version INTEGER, question TEXT, status TEXT)',
  );
  await db.database.execute(
    'CREATE TABLE conversation_artifacts (id TEXT PRIMARY KEY, session_id TEXT, result_json TEXT)',
  );
  await db.database.execute(
    "INSERT INTO conversation_artifact_sessions VALUES ('s', 1, 0)",
  );
  await db.database.execute(
    "INSERT INTO conversation_requests VALUES ('r', 's', 1, ?, 'active')",
    [input.question],
  );
  return db;
}

test('concurrent connections do not double-write; reopening reuses durable receipt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-receipt-'));
  const path = join(dir, 'records.sqlite');
  const first = await setup(path);
  const second = createHealthEvidenceTestDatabase(path);
  try {
    const results = await Promise.allSettled([
      saveConversationHealthHistory(first.database, input, signal),
      saveConversationHealthHistory(second.database, input, signal),
    ]);
    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(
      1,
    );
    expect(
      await createRecordRepository(first.database).manualHistory.list(),
    ).toHaveLength(1);
  } finally {
    first.close();
    second.close();
  }
  const reopened = createHealthEvidenceTestDatabase(path);
  try {
    const id = await saveConversationHealthHistory(
      reopened.database,
      input,
      signal,
    );
    expect(id).toBe('conversation-history:r');
    expect(
      await createRecordRepository(reopened.database).manualHistory.list(),
    ).toHaveLength(1);
    expect(
      (
        await reopened.database.execute(
          'SELECT * FROM conversation_history_receipts',
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    reopened.close();
    rmSync(dir, { recursive: true });
  }
});

test.each(['changed', 'deleted'])(
  'prior source %s before dispatch fails closed',
  async mode => {
    const db = await setup(':memory:');
    try {
      const source = '어릴 때 수술했어요.';
      await db.database.execute(
        "INSERT INTO conversation_artifacts VALUES ('prior', 's', ?)",
        [JSON.stringify({ question: source })],
      );
      if (mode === 'deleted')
        await db.database.execute('DELETE FROM conversation_artifacts');
      else
        await db.database.execute(
          'UPDATE conversation_artifacts SET result_json = ?',
          [JSON.stringify({ question: '수술하지 않았어요.' })],
        );
      await expect(
        saveConversationHealthHistory(
          db.database,
          {
            ...input,
            approvedSource: { requestId: 'prior', text: source },
          },
          signal,
        ),
      ).rejects.toThrow(mode === 'deleted' ? 'removed' : 'changed');
      expect(
        await createRecordRepository(db.database).manualHistory.list(),
      ).toHaveLength(0);
    } finally {
      db.close();
    }
  },
);
