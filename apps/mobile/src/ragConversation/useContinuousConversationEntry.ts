import { useEffect } from 'react';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import { useConversationEntryIntent } from './useConversationEntryIntent';

/** Reconcile the active model on route return, then apply an entry only after same-id restoration settles. */
export function useContinuousConversationEntry(
  store: ConversationSessions,
  context: ConversationEntryContext | undefined,
  session: ConversationSession,
  revision: number | undefined,
  current: boolean,
) {
  useEffect(() => {
    if (current)
      store
        .synchronizeModel(true, 'restart-interrupted-initial-page')
        .catch(() => {});
  }, [store, revision, current]);
  useConversationEntryIntent(
    store,
    context,
    session.id,
    Boolean(
      session.restoring ||
      session.modelSelectionPending ||
      session.restoreFailed ||
      session.modelSelectionFailed,
    ),
  );
}
