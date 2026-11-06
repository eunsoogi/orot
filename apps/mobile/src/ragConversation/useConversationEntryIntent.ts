import { useEffect } from 'react';
import type { ConversationSessions } from './conversationSessions';
import {
  conversationIntentRequests,
  type ConversationEntryContext,
} from '../aiFeatures/integration/conversationIntent';

const appliedEntries = new WeakMap<ConversationSessions, Set<string>>();
const sessionEntries = new WeakMap<
  ConversationSessions,
  Map<number, ConversationEntryContext>
>();

/** Entry metadata follows its session, not whichever route happens to be visible. */
export function conversationEntryForSession(
  store: ConversationSessions,
  id: number,
) {
  return sessionEntries.get(store)?.get(id);
}

/** Applies an entry once without replacing drafts or restarting work after overlay return. */
export function useConversationEntryIntent(
  store: ConversationSessions,
  context?: ConversationEntryContext,
) {
  useEffect(() => {
    if (!context) return;
    const key = context.entryKey + ':' + context.intent;
    // Provider/source native scenes mount another presentation of the retained entry.
    // The app-owned store, rather than a component mount, defines its once-only lifetime.
    let applied = appliedEntries.get(store);
    if (!applied) {
      applied = new Set();
      appliedEntries.set(store, applied);
    }
    if (applied.has(key)) return;
    applied.add(key);
    const request = conversationIntentRequests[context.intent];
    const snapshot = store.getSnapshot();
    const active = snapshot.sessions.find(
      item => item.id === snapshot.activeId,
    )!;
    // A route entry must not overwrite an unrelated draft, exchange or pending response.
    if (request && (active.draft || active.messages.length || active.busy))
      store.create();
    const id = store.getSnapshot().activeId;
    let entries = sessionEntries.get(store);
    if (!entries) {
      entries = new Map();
      sessionEntries.set(store, entries);
    }
    // A plain entry must not relabel an existing conversation selected in history.
    if (request || !entries.has(id)) entries.set(id, context);
    if (request) store.setDraft(id, request);
  }, [context, store]);
}
