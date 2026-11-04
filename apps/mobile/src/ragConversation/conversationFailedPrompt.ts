import type { ConversationSession } from './conversationSessionTypes';

/** A stopped stream remains visible as an incomplete draft, never validated history. */
export function retainPartial(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  nextId: () => number,
  id: number,
  activity: string,
  retainEmpty = false,
) {
  const session = find(id);
  const content = session.pendingMessage?.content ?? '';
  update(id, {
    pendingMessage: null,
    messages:
      content || retainEmpty
        ? [
            ...session.messages,
            {
              id: session.pendingMessage?.id ?? nextId(),
              role: 'assistant',
              content,
              activity,
              incomplete: true,
            },
          ]
        : session.messages,
  });
}

/** A failed prompt remains visible while its draft is restored without overwriting newer input. */
export function restoreFailedPrompt(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  id: number,
  question: string,
  userMessageId: number,
  error?: string,
  idle = false,
) {
  const session = find(id);
  const hasDifferentDraft =
    session.draft.trim().length > 0 && session.draft.trim() !== question;
  update(id, {
    pendingMessage: null,
    draft: hasDifferentDraft ? session.draft : question,
    messages: session.messages.map(message =>
      message.id === userMessageId ? { ...message, failed: true } : message,
    ),
    ...(error === undefined ? {} : { error }),
    ...(idle ? { busy: false } : {}),
  });
}
