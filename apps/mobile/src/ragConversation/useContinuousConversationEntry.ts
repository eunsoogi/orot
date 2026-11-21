import { useEffect, useRef } from 'react';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import { useConversationEntryIntent } from './useConversationEntryIntent';
import { visibleSavedHistoryDisplay } from './conversationSavedHistoryDisplay';

/** Reconcile the active model on route return, then apply an entry only after same-id restoration settles. */
export function useContinuousConversationEntry(
  store: ConversationSessions,
  context: ConversationEntryContext | undefined,
  session: ConversationSession,
  revision: number | undefined,
  current: boolean,
  ownsPresentation = current,
) {
  const selection = useRef({ revision, changed: false });
  const synchronized = useRef<
    { store: ConversationSessions; revision?: number } | undefined
  >(undefined);
  useEffect(() => {
    if (selection.current.revision !== revision)
      selection.current = { revision, changed: true };
    if (!ownsPresentation) synchronized.current = undefined;
    if (!current) return;
    const snapshot = store.getSnapshot();
    const active = snapshot.sessions.find(
      item => item.id === snapshot.activeId,
    );
    if (
      synchronized.current?.store === store &&
      synchronized.current.revision === revision &&
      active &&
      visibleSavedHistoryDisplay(active) !== undefined
    )
      return;
    // Backgrounding a still-owned scene is not route reentry. Do not replace
    // the current model lookup or transiently drop validated transcript rows.
    synchronized.current = { store, revision };
    // An explicit provider edit is a strict selection change, not a route return.
    const routeReturn = selection.current.changed
      ? undefined
      : 'restart-interrupted-initial-page';
    selection.current.changed = false;
    store.synchronizeModel(true, routeReturn).catch(() => {});
  }, [store, revision, current, ownsPresentation]);
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
