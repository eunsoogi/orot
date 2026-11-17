import { createDailyReportIdentity } from '@orot/domain';
import { createConversationSessions } from '../conversationSessions';
import { entryIntentSender } from '../entryIntentSender';

const target = {
  identity: createDailyReportIdentity('2035-01-01', 'UTC'),
  runId: 'synthetic-report',
  revision: 1,
};
const turn = {
  question: 'Synthetic report request',
  answer: 'Synthetic report',
  citations: [],
  dailyReport: target,
};
const retention = {
  attachExisting: async () => {},
  activeIdentity: () => 'saved',
  activeLease: () => null,
  beginTurn: async () => undefined,
  invalidate: () => {},
} as never;

test.each(['full', 'paged', 'live'] as const)(
  'historical report metadata is not an implicit new selected target (%s)',
  async mode => {
    const store = createConversationSessions({
      retention,
      ...(mode !== 'live' ? { restoreSession: async () => [turn] } : {}),
      ...(mode === 'paged'
        ? {
            restoreSessionPage: async () => ({
              turns: [turn],
              taskCards: [],
              nextCursor: null,
            }),
          }
        : {}),
    });
    let id = store.getSnapshot().activeId;
    if (mode === 'live')
      await store.sendPrompt(id, turn.question, async () => ({
        status: 'answer',
        answer: turn.answer,
        citations: [],
        dailyReport: target,
      }));
    else id = await store.attachExisting('saved', 0, '2035-01-01T00:00:00Z');
    const session = store.getSnapshot().sessions.find(item => item.id === id)!;
    expect(
      session.messages.some(
        message => message.dailyReport?.runId === target.runId,
      ),
    ).toBe(true);
    expect(session.dailyReport).toBeUndefined();
    const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
    await store.sendPrompt(
      id,
      'Synthetic independent question',
      entryIntentSender(store, id, send),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[4]).not.toEqual(
      expect.objectContaining({ dailyReport: target }),
    );
    store.dispose();
  },
);
