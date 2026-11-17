import {
  conversationIntentRequests,
  type ConversationIntent,
} from '../aiFeatures/integration/conversationIntent';
import { conversationComposerDisabled } from './conversationComposerDisabled';
import type {
  ConversationSessions,
  ConversationSession,
} from './conversationSessions';
import { setConversationEntryForSession } from './useConversationEntryIntent';

type Choice = Extract<
  ConversationIntent,
  'possibilities' | 'visit-questions' | 'health-summary'
>;

/** Pending input or an owned request must not silently acquire a different medical purpose. */
export function canSelectConversationChoice(
  store: ConversationSessions,
  session: ConversationSession,
) {
  return (
    !session.busy &&
    !session.preparingSend &&
    !session.draft &&
    !conversationComposerDisabled(session, store.continuous) &&
    store.photoDrafts.get(session.id).status === 'empty'
  );
}

/** Explicit choice stays in the current session; the existing suggestion/prepare action owns consent. */
export function selectConversationChoice(
  store: ConversationSessions,
  intent: Choice,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return false;
  const snapshot = store.getSnapshot();
  const session = snapshot.sessions.find(item => item.id === snapshot.activeId);
  if (!session || !canSelectConversationChoice(store, session)) return false;
  setConversationEntryForSession(store, session.id, {
    intent,
    entryKey: `conversation-choice:${session.id}`,
  });
  store.prepareEntry(session.id, conversationIntentRequests[intent]);
  return true;
}

/** Shared flow callbacks never create a route or a session for a conversation choice. */
export function conversationChoiceActions(
  store: ConversationSessions,
  isCurrent: () => boolean,
) {
  return {
    onOpenHealthSummary: () => {
      selectConversationChoice(store, 'health-summary', isCurrent);
    },
    onOpenVisitQuestions: () => {
      selectConversationChoice(store, 'visit-questions', isCurrent);
    },
    onOpenDiseaseHypotheses: () => {
      selectConversationChoice(store, 'possibilities', isCurrent);
    },
  };
}
