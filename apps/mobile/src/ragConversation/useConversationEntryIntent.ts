import { useEffect, useRef } from 'react';
import type { ConversationSessions } from './conversationSessions';
import {
  conversationIntentRequests,
  type ConversationEntryContext,
} from '../aiFeatures/integration/conversationIntent';

const appliedEntries = new WeakMap<ConversationSessions, Set<string>>();
// Reentry returns to the visit's own session without replaying its operation.
const visitEntrySessions = new WeakMap<
  ConversationSessions,
  Map<string, number>
>();
const sessionEntries = new WeakMap<
  ConversationSessions,
  Map<number, ConversationEntryContext>
>();

/** Keeps appointment-specific entry ownership distinct even before a session has content. */
function conversationEntryContextKey(context: ConversationEntryContext) {
  return JSON.stringify([
    context.entryKey,
    context.intent,
    context.appointmentId ?? null,
  ]);
}

/** Entry metadata follows its session, not whichever route happens to be visible. */
export function conversationEntryForSession(
  store: ConversationSessions,
  id: number,
) {
  return sessionEntries.get(store)?.get(id);
}

/** Applies route intent once; only an explicit session action may start its work. */
export function consumeConversationEntryForSession(
  store: ConversationSessions,
  id: number,
) {
  const entries = sessionEntries.get(store);
  const context = entries?.get(id);
  if (context?.intent === 'health-summary')
    entries?.set(id, { ...context, intent: 'conversation' });
  return context;
}

/** Applies an entry once without replacing drafts or restarting work after overlay return. */
export function useConversationEntryIntent(
  store: ConversationSessions,
  context?: ConversationEntryContext,
) {
  const previousEntryKey = useRef<string | null>(null);
  useEffect(() => {
    if (!context) return;
    // Reusing a route key for another appointment must create a fresh target session.
    const key = conversationEntryContextKey(context);
    const previousKey = previousEntryKey.current;
    previousEntryKey.current = key;
    // Provider/source native scenes mount another presentation of the retained entry.
    // The app-owned store, rather than a component mount, defines its once-only lifetime.
    let applied = appliedEntries.get(store);
    if (!applied) {
      applied = new Set();
      appliedEntries.set(store, applied);
    }
    if (applied.has(key)) {
      if (
        context.intent === 'visit-questions' &&
        previousKey !== null &&
        previousKey !== key
      ) {
        const sessions = visitEntrySessions.get(store);
        const id = sessions?.get(key);
        const snapshot = store.getSnapshot();
        if (
          id !== undefined &&
          snapshot.sessions.some(item => item.id === id)
        ) {
          if (snapshot.activeId !== id) store.select(id);
          return;
        }
        sessions?.delete(key);
        applied.delete(key);
      } else return;
    }
    applied.add(key);
    const request = conversationIntentRequests[context.intent];
    const snapshot = store.getSnapshot();
    const active = snapshot.sessions.find(
      item => item.id === snapshot.activeId,
    )!;
    const activeEntry = sessionEntries.get(store)?.get(active.id);
    const hasSpecializedEntry = Boolean(
      active.dailyReport ||
      active.entryIntent ||
      active.entryPrompt ||
      (activeEntry && activeEntry.intent !== 'conversation'),
    );
    const changesOwnedEntry =
      request &&
      hasSpecializedEntry &&
      (!activeEntry || conversationEntryContextKey(activeEntry) !== key);
    // A route entry must not overwrite an unrelated draft, exchange or pending response.
    if (
      context.dailyReport ||
      (request &&
        (active.draft ||
          active.messages.length ||
          active.busy ||
          changesOwnedEntry))
    )
      store.create();
    const id = store.getSnapshot().activeId;
    let entries = sessionEntries.get(store);
    if (!entries) {
      entries = new Map();
      sessionEntries.set(store, entries);
    }
    // A plain entry must not relabel an existing conversation selected in history.
    if (context.dailyReport || request || !entries.has(id))
      entries.set(id, context);
    if (context.intent === 'visit-questions') {
      let sessions = visitEntrySessions.get(store);
      if (!sessions) {
        sessions = new Map();
        visitEntrySessions.set(store, sessions);
      }
      sessions.set(key, id);
    }
    if (context.dailyReport) store.selectDailyReport(id, context.dailyReport);
    if (request) store.setEntryPrompt(id, request);
  }, [context, store]);
}
