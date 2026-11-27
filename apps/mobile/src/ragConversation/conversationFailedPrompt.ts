import { getRagConversationFailureCopy } from './copy';
import {
  conversationEvidenceRejectsDraft,
  type RagConversationFailureKind,
  type RagConversationOutcome,
} from './outcome';
import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';

/** Recover the composer while keeping terminally rejected output out of the transcript. */
export function conversationFailureReporter(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  request: PendingTurn,
  retain: (id: number, activity: string) => void,
  id: number,
) {
  return (
    failure:
      | RagConversationFailureKind
      | Extract<RagConversationOutcome, { status: 'failure' }>,
    partialCopy?: string,
    rejectedOpeningTurnId?: string,
  ) => {
    const kind = typeof failure === 'string' ? failure : failure.kind;
    const failureCopy = getRagConversationFailureCopy(kind);
    if (
      kind === 'validation_failed' ||
      kind === 'provider_refused' ||
      kind === 'protected_memory_not_saved' ||
      (typeof failure !== 'string'
        ? conversationEvidenceRejectsDraft(failure)
        : kind === 'stale_evidence')
    ) {
      const { pendingMessage: pending, messages } = find(id);
      const opening = pending?.initialResponse;
      // A separately reviewed opening is not proof of a bookmark. After that
      // exact save fails, keep only the authoritative failure, not its opening.
      // Other failures still retain independently reviewed, non-receipt text.
      if (
        kind !== 'answer_memory_not_saved' &&
        kind !== 'protected_memory_not_saved' &&
        pending &&
        !pending.withholdHealthBody &&
        opening &&
        opening.source !== 'receipt'
      )
        update(id, {
          pendingMessage: null,
          messages: [
            ...messages,
            {
              id: pending.id,
              role: 'assistant',
              content: '',
              initialResponse: opening,
              // Only pair the opening already visible with its saved display row;
              // a rejected body does not own durable tools, recovery, or history.
              rejectedOpeningTurnId,
              // Exclude this opening from future answer context without an
              // interruption label, body, or resumption metadata.
              incomplete: true,
            },
          ],
        });
    } else retain(id, partialCopy ?? failureCopy);
    restoreFailedPrompt(
      find,
      update,
      id,
      request.question,
      request.userMessageId,
      failureCopy,
      false,
      request.restorePromptToComposer,
    );
  };
}

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
      content ||
      session.pendingMessage?.initialResponse ||
      retainEmpty ||
      session.pendingMessage?.previousOutputs?.length ||
      session.pendingMessage?.toolEvents?.length
        ? [
            ...session.messages,
            {
              id: session.pendingMessage?.id ?? nextId(),
              role: 'assistant',
              content,
              initialResponse: session.pendingMessage?.withholdHealthBody
                ? undefined
                : session.pendingMessage?.initialResponse,
              previousOutputs: session.pendingMessage?.withholdHealthBody
                ? undefined
                : session.pendingMessage?.previousOutputs,
              activity,
              incomplete: true,
              toolMessageId: session.pendingMessage?.toolMessageId,
              toolEvents: session.pendingMessage?.toolEvents,
            },
          ]
        : session.messages,
  });
}

/** Keep a failed prompt visible and restore it to the composer only when it came from there. */
export function restoreFailedPrompt(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  id: number,
  question: string,
  userMessageId: number,
  error?: string,
  idle = false,
  restorePromptToComposer = true,
) {
  const session = find(id);
  const hasDifferentDraft =
    session.draft.trim().length > 0 && session.draft.trim() !== question;
  update(id, {
    pendingMessage: null,
    ...(restorePromptToComposer
      ? { draft: hasDifferentDraft ? session.draft : question }
      : {}),
    messages: session.messages.map(message =>
      message.id === userMessageId
        ? { ...message, failed: true, deliveryPending: false }
        : message,
    ),
    ...(error === undefined ? {} : { error }),
    ...(idle ? { busy: false } : {}),
  });
}
