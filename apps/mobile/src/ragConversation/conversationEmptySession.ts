import type {
  ConversationSession,
  ConversationSnapshot,
} from './conversationSessionTypes';
import { getRagConversationCopy } from './copy';

/** A new conversation has no prior generated text or active request. */
export function createEmptyConversation(id: number): ConversationSession {
  return {
    id,
    title: getRagConversationCopy().newConversation,
    createdAt: new Date().toISOString(),
    draft: '',
    messages: [],
    pendingMessage: null,
    busy: false,
    error: '',
  };
}

/** The first session is active until a user selects or creates another one. */
export function initialConversationSnapshot(
  session: ConversationSession,
): ConversationSnapshot {
  return { activeId: session.id, sessions: [session], deleted: null };
}

/** Withhold cached private content until a deletion's durable outcome is known. */
export function quarantineConversation(): Partial<ConversationSession> {
  return {
    busy: true,
    deletionError: '',
    quarantined: true,
    messages: [],
    draft: '',
    title: getRagConversationCopy().newConversation,
    unsavedCount: 0,
  };
}
