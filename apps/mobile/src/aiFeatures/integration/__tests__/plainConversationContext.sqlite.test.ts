import { createDailyReportIdentity } from '@orot/domain';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

const date = (i: number) => new Date(Date.UTC(2026, 9, 7, 0, i)).toISOString();
const session = 'plain-context';
const signal = () => new AbortController().signal;
async function fixture() {
  const f = await quarantinedHistoryFixture();
  await f.storage.createSession(session, await f.storage.currentGeneration());
  const append = (id: string, minute: number) =>
    f.storage.append({
      id,
      sessionId: session,
      createdAt: date(minute),
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      question: 'Synthetic saved question ' + minute,
      answer: 'Synthetic saved answer ' + minute,
      citations: [],
      sources: [],
    });
  return { ...f, append };
}

test('recreated storage needs no extra context copy and reproduces old settled turn order', async () => {
  const f = await fixture();
  try {
    let x = 0;
    for (const key of ['twelve', 'second', 'later', 'first'])
      await f.append(key, x++);
    const legacy = await conversationHistoryPageOption(f.input, f.open)(
      session,
      signal(),
    );
    const existing = createConversationArtifactStorage(f.database);
    const plain = await existing.readPlainContextPage(session, 0, signal());
    expect(plain).toEqual({
      status: 'plain',
      nextCursor: legacy.nextCursor,
      turns: legacy.turns.map(turn => ({
        id: turn.toolMessageId,
        question: turn.question,
      })),
    });
    expect(JSON.stringify(plain)).not.toContain('Synthetic saved answer');
  } finally {
    f.close();
  }
});

test.each([
  'malformed',
  'task',
  'interrupt',
  'lineage',
  'hide',
  'deleted',
  'abort',
] as const)(
  'does not mint a plain prior-context projection when %s changes the exact authority',
  async mode => {
    const f = await fixture();
    try {
      await f.append('first', 0);
      await f.append('second', 1);
      if (mode === 'malformed')
        await f.database.execute(
          "UPDATE conversation_artifacts SET result_json = json_set(result_json,'$.answer',null) WHERE id = ?",
          ['second'],
        );
      if (mode === 'task')
        await f.storage.writeTaskCard({
          sessionId: session,
          sessionVersion: 0,
          id: 'task',
          createdAt: date(2),
          expectedRevision: null,
          task: {
            kind: 'daily_report',
            identity: createDailyReportIdentity('2026-10-07', 'UTC'),
          },
        });
      if (mode === 'interrupt') {
        const request = {
          id: 'paused',
          sessionId: session,
          sessionVersion: 0,
          createdAt: date(2),
          question: 'Synthetic pending input',
        };
        await f.storage.startRequest(request);
        await f.storage.interruptRequest(
          request.id,
          session,
          0,
          'interrupted',
          'user-stopped',
        );
      }
      if (mode === 'hide') await f.storage.hideSession(session);
      if (mode === 'deleted')
        await f.database.execute(
          'INSERT OR IGNORE INTO conversation_deleted_artifacts(id) VALUES(?)',
          ['second'],
        );
      const current = new AbortController();
      if (mode === 'abort') current.abort();
      if (mode === 'hide' || mode === 'abort') {
        await expect(
          f.storage.readPlainContextPage(session, 0, current.signal),
        ).rejects.toThrow();
      } else {
        const candidate = await f.storage.readPlainContextPage(
          mode === 'lineage' ? 'session' : session,
          0,
          current.signal,
        );
        expect(candidate).toEqual({ status: 'fallback' });
      }
    } finally {
      f.close();
    }
  },
);
