import { entryIntentSender } from '../entryIntentSender';
import { consumeConversationEntryForSession } from '../useConversationEntryIntent';
import type { ConversationSessions } from '../conversationSessions';
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
    const store = {} as ConversationSessions;
    await entryIntentSender(store, 1, send)('summary', [], controller.signal, {
      onSummarySaveSettled: settled,
    });
    expect(settled).toHaveBeenCalledWith(committed);
    expect(consumeConversationEntryForSession).toHaveBeenCalledTimes(
      committed ? 1 : 0,
    );
  },
);
