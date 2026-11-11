import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';
import { createConversationSessions } from '../conversationSessions';
import { createDailyReportIdentity } from '@orot/domain';

test('a task restoration failure cancels the concurrent transcript read', async () => {
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  const update = jest.fn();
  const state = createConversationSessionRestoreState({
    update,
    read: async (_id, current) => {
      signal = current;
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return [];
    },
    readTasks: async () => {
      throw new Error('Synthetic failure');
    },
  });
  await state.start(1, 'saved');
  expect(signal?.aborted).toBe(true);
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ restoreFailed: true }),
  );
  finish();
});

test('disposing while a restore is pending aborts it and suppresses its late content', async () => {
  let finish!: (
    turns: { question: string; answer: string; citations: [] }[],
  ) => void;
  let signal: AbortSignal | undefined;
  const update = jest.fn();
  const state = createConversationSessionRestoreState({
    update,
    read: async (_id, current) => {
      signal = current;
      return new Promise(resolve => {
        finish = resolve;
      });
    },
  });
  const pending = state.start(1, 'durable');
  state.dispose();
  expect(signal?.aborted).toBe(true);
  finish([
    { question: 'stale question', answer: 'stale answer', citations: [] },
  ]);
  await pending;
  expect(update).toHaveBeenCalledTimes(1);
});

test('restores the possibilities intent with the validated conversation', async () => {
  const update = jest.fn();
  const state = createConversationSessionRestoreState({
    update,
    read: async () => [
      {
        question: '가능성을 살펴봐 주세요',
        answer: '추가 정보가 필요해요.',
        citations: [],
        entryIntent: 'possibilities' as const,
      },
    ],
  });
  await state.start(1, 'durable');
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ entryIntent: 'possibilities' }),
  );
});

test.each([
  ['empty', []],
  [
    'tool-only',
    [
      {
        question: '',
        answer: '',
        citations: [],
        toolMessageId: 'interrupted',
        toolEvents: [],
      },
    ],
  ],
] as const)(
  'allows a follow-up after restoring a general %s session',
  async (_kind, turns) => {
    const retention = {
      attachExisting: async () => {},
      activeIdentity: () => 'saved',
      activeLease: () => null,
      beginTurn: async () => undefined,
      invalidate: () => {},
    };
    const sessions = createConversationSessions({
      retention: retention as never,
      restoreSession: async () => turns,
    });
    const id = await sessions.attachExisting(
      'saved',
      0,
      '2026-10-05T00:00:00.000Z',
    );
    expect(
      sessions.getSnapshot().sessions.find(session => session.id === id)
        ?.restoreFailed,
    ).toBe(false);
    sessions.setDraft(id, 'follow-up');
    const send = jest.fn(async () => ({
      status: 'failure' as const,
      kind: 'retrieval_failed' as const,
    }));
    await sessions.send(id, send);
    expect(send).toHaveBeenCalledTimes(1);
    sessions.dispose();
  },
);

test('rejects conflicting saved report targets', async () => {
  const report = {
    identity: createDailyReportIdentity('2026-11-10', 'Asia/Seoul'),
    runId: 'report',
    revision: 1,
  };
  const update = jest.fn();
  const state = createConversationSessionRestoreState({
    update,
    read: async () => [
      { question: 'one', answer: 'answer', citations: [], dailyReport: report },
      {
        question: 'two',
        answer: 'answer',
        citations: [],
        dailyReport: { ...report, revision: 2 },
      },
    ],
  });
  await state.start(1, 'saved');
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ restoreFailed: true }),
  );
});

test('accepts the same saved report despite different JSON key order', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const report = { identity, runId: 'report', revision: 1 };
  const reordered = {
    revision: 1,
    runId: 'report',
    identity: {
      key: identity.key,
      timeZone: identity.timeZone,
      localDate: identity.localDate,
      kind: identity.kind,
    },
  };
  const update = jest.fn();
  const state = createConversationSessionRestoreState({
    update,
    read: async () => [
      { question: 'one', answer: 'answer', citations: [], dailyReport: report },
      {
        question: 'two',
        answer: 'answer',
        citations: [],
        dailyReport: reordered,
      },
    ],
  });
  await state.start(1, 'saved');
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ restoreFailed: false, dailyReport: report }),
  );
});
