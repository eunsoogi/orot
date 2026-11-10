import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSender } from './conversationSessionTypes';
import {
  conversationEntryForSession,
  consumeConversationEntryForSession,
} from './useConversationEntryIntent';

/** Retain entry intent for failed retries; a committed summary survives late cancellation. */
export function entryIntentSender(
  store: ConversationSessions,
  id: number,
  send: ConversationScreenProps['onSend'],
): ConversationSender {
  return async (question, history, signal, observer) => {
    const selected = conversationEntryForSession(store, id);
    // Restored possibility sessions retain their safety and grounding boundary on follow-up.
    const context =
      store.getSnapshot().sessions.find(item => item.id === id)?.entryIntent ===
        'possibilities' &&
      (!selected || selected.intent === 'conversation')
        ? { intent: 'possibilities' as const, entryKey: 'restored' }
        : selected;
    let committed = false;
    const scopedObserver = {
      ...observer,
      onSummarySaveSettled(value: boolean) {
        committed = value;
        observer?.onSummarySaveSettled?.(value);
      },
    };
    const outcome = context
      ? await send(question, history, signal, scopedObserver, context)
      : await send(question, history, signal, scopedObserver);
    if (
      (!signal?.aborted || committed) &&
      outcome.status !== 'failure' &&
      outcome.status !== 'unavailable'
    )
      consumeConversationEntryForSession(store, id);
    return outcome;
  };
}
