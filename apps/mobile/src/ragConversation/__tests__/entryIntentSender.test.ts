import { entryIntentSender } from '../entryIntentSender';
import { consumeConversationEntryForSession } from '../useConversationEntryIntent';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationScreenProps } from '../ConversationScreenProps';

jest.mock('../useConversationEntryIntent', () => ({
  conversationEntryForSession: jest.fn(() => ({
    intent: 'health-summary',
    entryKey: 'entry',
  })),
  consumeConversationEntryForSession: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])(
  'cancellation consumes intent only if the summary committed: %s',
  async committed => {
    const controller = new AbortController();
    const settled = jest.fn();
    const send: ConversationScreenProps['onSend'] = async (
      _question,
      _history,
      _signal,
      observer,
    ) => {
      controller.abort();
      observer?.onSummarySaveSettled?.(committed);
      return { status: 'no_evidence' };
    };
    const store = createConversationSessions();
    await entryIntentSender(store, 1, send)('summary', [], controller.signal, {
      onSummarySaveSettled: settled,
    });
    expect(settled).toHaveBeenCalledWith(committed);
    expect(consumeConversationEntryForSession).toHaveBeenCalledTimes(
      committed ? 1 : 0,
    );
    store.dispose();
  },
);

test('keeps the report selected when the turn was dispatched', async () => {
  const store = createConversationSessions();
  const first = {
    identity: {
      kind: 'daily_report' as const,
      key: 'first',
      localDate: '2026-11-10',
      timeZone: 'Asia/Seoul',
    },
    runId: 'first-run',
    revision: 1,
  };
  const second = {
    identity: {
      kind: 'daily_report' as const,
      key: 'second',
      localDate: '2026-11-11',
      timeZone: 'Asia/Seoul',
    },
    runId: 'second-run',
    revision: 2,
  };
  store.selectDailyReport(1, first);
  const send = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  const pending = entryIntentSender(store, 1, send);
  store.selectDailyReport(1, second);
  await pending('question', []);
  expect(send.mock.calls[0][4]).toMatchObject({ dailyReport: first });
  store.dispose();
});
