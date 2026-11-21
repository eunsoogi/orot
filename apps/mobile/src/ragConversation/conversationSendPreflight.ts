import type { PlainHistoryPlan } from './plainConversationSendContext';
import { observeConversationPreflight } from '../providers/conversationPreflightDiagnostic';
import { t } from '../i18n';
import type { ConversationSession } from './conversationSessionTypes';

/** Only explicit sends retry recoverable reads. A different owner or Stop is not an error. */
export function prepareConversationSend(input: {
  select: (id: number, signal?: AbortSignal) => Promise<boolean>;
  context: (
    id: number,
    signal: AbortSignal,
  ) => Promise<boolean | PlainHistoryPlan>;
  find: (id: number) => ConversationSession | undefined;
  current: (id: number) => boolean;
}) {
  return async (
    id: number,
    signal: AbortSignal,
  ): Promise<boolean | PlainHistoryPlan> => {
    const selected = await observeConversationPreflight(
      'model',
      () => input.select(id, signal),
      signal,
    );
    if (signal.aborted || !input.current(id)) return false;
    if (!selected) {
      if (input.find(id)?.modelSelectionFailed)
        throw new Error(t('ragConversation.preflight.failed'));
      return false;
    }
    let prepared: boolean | PlainHistoryPlan = false;
    const ready = await observeConversationPreflight(
      'history',
      async () => Boolean((prepared = await input.context(id, signal))),
      signal,
    );
    if (signal.aborted || !input.current(id)) return false;
    if (!ready) throw new Error(t('ragConversation.preflight.failed'));
    return prepared;
  };
}
