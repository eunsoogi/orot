import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { toolsFor } from '../../aiFeatures/integration/featureServiceExecution';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { saveConversationHealthHistory } from '../conversationHealthHistory';
import { conversationHistoryIntent } from '../../manualHistory/conversationHistoryIntent';

const question = '과거 건강 기록으로 저장해: 몇 년 전 수술을 받았던 것 같아요.';
const input = {
  requestId: 'synthetic-request',
  sessionId: 'synthetic-session',
  sessionVersion: 1,
  question,
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
    [input.requestId, input.sessionId, question],
  );
  return { ...db, records: createRecordRepository(db.database) };
}

test('requires a direct save command and preserves uncertainty verbatim', () => {
  expect(conversationHistoryIntent(question)).toBe(
    '몇 년 전 수술을 받았던 것 같아요.',
  );
  for (const text of [
    '이거 저장해',
    '수술했을까요?',
    '저장하지 마',
    '친구가 "과거 건강 기록으로 저장해: 수술"이라고 했어',
  ])
    expect(conversationHistoryIntent(text)).toBeUndefined();
});

test('saves once in real SQLite and keeps the original words as unreviewed, unknown-date evidence', async () => {
  const { database, records, close } = await fixture();
  try {
    const signal = new AbortController().signal;
    const id = await saveConversationHealthHistory(database, input, signal);
    expect(await saveConversationHealthHistory(database, input, signal)).toBe(
      id,
    );
    expect(await records.manualHistory.list()).toHaveLength(1);
    expect(await records.manualHistory.getEvidence(id)).toMatchObject({
      effectiveDate: { status: 'unknown' },
      reviewState: { status: 'unreviewed' },
      provenance: { origin: 'user_reported' },
      text: expect.stringContaining('몇 년 전 수술을 받았던 것 같아요.'),
    });
    expect(
      (await database.execute('SELECT * FROM conversation_history_receipts'))
        .rows,
    ).toEqual([
      {
        request_id: input.requestId,
        session_id: input.sessionId,
        entry_id: id,
        source_request_id: input.requestId,
      },
    ]);
    // Exercise the actual separate read tool, with synthetic ranking only.
    const registry = new LocalEvidenceReferenceRegistry();
    const data: AiFeatureLocalData = {
      ...createLocalEvidenceData(database),
      repository: createLocalHealthEvidenceRepository(database),
      memoryStorage: { listRecords: async () => [] },
      loadMemoryRecords: async () => [],
      rag: {
        index: async () => undefined,
        search: async (_query, chunks, limit = 8) =>
          chunks
            .slice(0, limit)
            .map(chunk => ({ chunk, score: 1, lexicalRank: 1, vectorRank: 1 })),
      },
    };
    const tool = toolsFor(undefined, data, registry).find(
      item => item.id === 'local-personal-records',
    )!;
    expect(tool.execution).toBe('local_read_only');
    const found = await tool.search({
      operationRunId: 'synthetic-read',
      operationKey: 'history-read',
      input: { query: '수술' },
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 4,
      maxPayloadBytes: 8192,
      signal,
    });
    if ('status' in found) throw new Error('Expected read evidence');
    const hit = found.items.find(item => item.content.includes('수술'))!;
    expect(hit).toBeDefined();
    expect(JSON.stringify(found)).not.toContain(id);
    expect(await registry.revalidateEvidence([hit], signal)).toBe(true);
    await records.manualHistory.delete(id);
    expect(await registry.revalidateEvidence([hit], signal)).toBe(false);
    await expect(
      saveConversationHealthHistory(database, input, signal),
    ).rejects.toThrow('removed');
    expect(await records.manualHistory.list()).toHaveLength(0);
  } finally {
    close();
  }
});

test('does not overwrite corrections or duplicate another request receipt', async () => {
  const { database, records, close } = await fixture();
  try {
    const signal = new AbortController().signal;
    const id = await saveConversationHealthHistory(database, input, signal);
    const correction = await records.manualHistory.correct(id, {
      kind: 'note',
      title: 'Synthetic correction',
      details: 'Corrected synthetic report',
      effectiveDate: { status: 'unknown' },
    });
    await expect(
      saveConversationHealthHistory(database, input, signal),
    ).rejects.toThrow('corrected');
    expect((await records.manualHistory.list()).map(entry => entry.id)).toEqual(
      [correction.id],
    );
  } finally {
    close();
  }
});

test.each(['cancelled', 'completed', 'interrupted'])(
  'rejects stale %s requests',
  async status => {
    const { database, records, close } = await fixture();
    try {
      await database.execute('UPDATE conversation_requests SET status = ?', [
        status,
      ]);
      await expect(
        saveConversationHealthHistory(
          database,
          input,
          new AbortController().signal,
        ),
      ).rejects.toThrow('no longer active');
      expect(await records.manualHistory.list()).toHaveLength(0);
    } finally {
      close();
    }
  },
);

test('rejects replaced, hidden, removed, mismatched and cancelled sources without modifying other records', async () => {
  const { database, records, close } = await fixture();
  try {
    const unrelated = await records.manualHistory.create({
      kind: 'note',
      title: 'Unrelated',
      details: 'Keep',
      effectiveDate: { status: 'unknown' },
    });
    const signal = new AbortController().signal;
    await expect(
      saveConversationHealthHistory(
        database,
        { ...input, sessionVersion: 2 },
        signal,
      ),
    ).rejects.toThrow();
    await expect(
      saveConversationHealthHistory(
        database,
        { ...input, question: '과거 건강 기록으로 저장해: invented' },
        signal,
      ),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      saveConversationHealthHistory(database, input, controller.signal),
    ).rejects.toThrow();
    await database.execute(
      'UPDATE conversation_artifact_sessions SET hidden = 1',
    );
    await expect(
      saveConversationHealthHistory(database, input, signal),
    ).rejects.toThrow();
    await database.execute('DELETE FROM conversation_artifact_sessions');
    await expect(
      saveConversationHealthHistory(database, input, signal),
    ).rejects.toThrow();
    expect(await records.manualHistory.list()).toEqual([unrelated]);
  } finally {
    close();
  }
});

test('rolls back the record when the receipt cannot commit', async () => {
  const { database, records, close } = await fixture();
  try {
    await database.execute(
      'CREATE TABLE conversation_history_receipts (request_id TEXT PRIMARY KEY, session_id TEXT, entry_id TEXT, source_request_id TEXT)',
    );
    await database.execute(
      "CREATE TRIGGER reject_history_receipt BEFORE INSERT ON conversation_history_receipts BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END",
    );
    await expect(
      saveConversationHealthHistory(
        database,
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(await records.manualHistory.list()).toHaveLength(0);
    expect(
      (await database.execute('SELECT * FROM conversation_history_receipts'))
        .rows,
    ).toHaveLength(0);
  } finally {
    close();
  }
});
