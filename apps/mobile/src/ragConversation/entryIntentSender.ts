import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSender } from './conversationSessionTypes';
import { observeConversationRequest } from './conversationRequestObservation';
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
  // Freeze the selected source before storage preflight can yield to another selection.
  const selected = conversationEntryForSession(store, id);
  const restored = store.getSnapshot().sessions.find(item => item.id === id);
  return async (question, history, signal, observer) => {
    // Restored targets are revalidated by the same guard used for the original entry.
    // Restored possibility sessions retain their safety and grounding boundary on follow-up.
    const context =
      selected && selected.intent !== 'conversation'
        ? {
            ...selected,
            ...(restored?.dailyReport
              ? { dailyReport: restored.dailyReport }
              : {}),
          }
        : restored?.dailyReport
          ? {
              intent: restored.entryIntent ?? ('conversation' as const),
              entryKey: 'restored',
              dailyReport: restored.dailyReport,
            }
          : restored?.entryIntent === 'possibilities' &&
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
    observeConversationRequest('sender-invoked');
    const outcome = context
      ? await send(question, history, signal, scopedObserver, context)
      : await send(question, history, signal, scopedObserver);
    observeConversationRequest(
      outcome.status === 'failure' && outcome.kind === 'provider_configuration'
        ? 'provider-configuration'
        : 'other-outcome',
    );
    if (
      (!signal?.aborted || committed) &&
      outcome.status !== 'failure' &&
      outcome.status !== 'unavailable'
    ) {
      consumeConversationEntryForSession(store, id);
      store.setEntryPrompt(id, undefined);
    }
    return outcome;
  };
}
