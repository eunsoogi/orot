import { useEffect, useRef } from 'react';
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
  const selection = useRef({ revision, changed: false });
  useEffect(() => {
    if (selection.current.revision !== revision)
      selection.current = { revision, changed: true };
    if (!current) return;
    // An explicit provider edit is a strict selection change, not a route return.
    const routeReturn = selection.current.changed
      ? undefined
      : 'restart-interrupted-initial-page';
    selection.current.changed = false;
    store.synchronizeModel(true, routeReturn).catch(() => {});
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
